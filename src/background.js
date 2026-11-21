// Service worker: owns capture state, picks the caption source, routes captions to the page,
// and runs translation and quizzes.
import "../extension/settings.js";
import { translateLine, translateBatch, generateQuiz, generateWordQuiz, listModels, friendlyError } from "./llm.js";

const { getSettings, t, dayKey, baseLang, languageName } = globalThis.Kavra;
const MAX_GAP_MS = 30000; // silence longer than this does not count as watch time
const MIN_QUIZ_LINES = 8;
const PAGE_CAPTION_HOLD_MS = 15000; // after a site caption, ignore speech recognition this long
const CACHE_SIZE = 400;
const PREFETCH_LOW = 2; // translate ahead once fewer than this many upcoming cues are ready
const ACTIVITY_DAYS = 400; // days of history kept for the activity view
const WORDS_MAX = 1000; // lines kept in the word pool
const WORD_QUIZ_MIN = 4; // saved lines needed for a word pool quiz
const WORD_QUIZ_PICK = 12; // saved lines a word pool quiz is written from
const QUIZZES_MAX = 50; // quizzes kept in the history

// ---- persistent state ----
// session "capture": { tabId, speech, source, video } for the tab being captioned (cleared on browser restart).
// local "progress": transcript and watch time collected since the last quiz.
// local "activity": totals per local day ("YYYY-MM-DD") for the activity view.
async function getCapture() {
  return (await chrome.storage.session.get("capture")).capture || null;
}
async function setCapture(capture) {
  await chrome.storage.session.set({ capture });
}

const emptyProgress = () => ({ lines: [], clicked: [], segmentMs: 0, lastFinalAt: 0 });
let storeQueue = Promise.resolve();
// Serializes read-modify-write of stored records so bursts of captions don't lose updates.
function updateStore(key, init, fn) {
  const run = storeQueue.then(async () => {
    const value = (await chrome.storage.local.get(key))[key] || init();
    const result = await fn(value);
    await chrome.storage.local.set({ [key]: value });
    return result;
  });
  storeQueue = run.catch(() => {});
  return run;
}
const updateProgress = (fn) => updateStore("progress", emptyProgress, fn);

function recordActivity(changes) {
  return updateStore("activity", () => ({}), (days) => {
    const day = (days[dayKey()] ??= { ms: 0, lines: 0, lookedUp: 0, quizzes: 0, correct: 0, wrong: 0 });
    for (const [field, amount] of Object.entries(changes)) day[field] = (day[field] || 0) + amount;
    const keys = Object.keys(days).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - ACTIVITY_DAYS))) delete days[old];
  });
}

// ---- messaging helpers ----
// Every frame gets captions and statuses: the overlay in an embedded player's frame takes over when
// that player goes fullscreen, since nothing outside it is drawn then.
function toAllFrames(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(() => {}); // tab may be reloading
}

async function injectScripts(tabId) {
  // Every frame, so players embedded from another site are read too. The scripts skip frames where
  // they already run, so this is safe to repeat when new frames appear.
  const files = ["settings.js", "overlay.js", "reader.js"];
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, files })
    .catch(() => chrome.scripting.executeScript({ target: { tabId }, files }));
}

async function closeOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length) await chrome.offscreen.closeDocument();
}

// ---- capture lifecycle ----
async function startCaptions(tabId, streamId) {
  await stopCaptions();
  const { targetLang, source } = await getSettings();
  await injectScripts(tabId);
  const { url } = await chrome.tabs.get(tabId);
  await setCapture({ tabId, speech: Boolean(streamId), source, video: videoKey(url) });
  speechListening = true; // a new offscreen document starts listening
  if (streamId) {
    const params = new URLSearchParams({ streamId, lang: targetLang });
    await chrome.offscreen.createDocument({
      url: `offscreen.html?${params}`,
      reasons: ["USER_MEDIA"],
      justification: "Capture the tab's audio and turn speech into captions.",
    });
  }
  toAllFrames(tabId, {
    type: "status",
    text: streamId ? t("statusListening") : t("statusWaitingPage"),
  });
}

async function stopCaptions(message) {
  const capture = await getCapture();
  await setCapture(null);
  await closeOffscreen();
  pageCaptionAt = 0;
  lastFinal = "";
  pending = { text: "", source: "speech" };
  clearTimeout(pendingTimer);
  clearTimeout(silenceTimer);
  videoPaused = false;
  mismatchStreak = 0;
  mismatchWarned = false;
  if (capture) toAllFrames(capture.tabId, { type: "stop", message });
}

// ---- caption routing ----
// Site subtitles are preferred: while they flow, speech recognition is paused and its output ignored.
let pageCaptionAt = 0;
let speechListening = true;
let resumeSpeechTimer;
let lastFinal = "";

function setSpeechListening(on) {
  if (speechListening === on) return;
  speechListening = on;
  chrome.runtime.sendMessage({ target: "offscreen", type: "setListening", on }).catch(() => {});
}

// Lines in another language than the one being learned (a dubbed audio track, the site's subtitles in
// the user's own language) are skipped, and after two in a row the user is told why.
let mismatchStreak = 0;
let mismatchWarned = false;

async function inLearningLanguage(text, tabId) {
  const { targetLang } = await getSettings();
  const result = await chrome.i18n.detectLanguage(text).catch(() => null);
  const top = result?.isReliable ? result.languages?.[0] : null;
  if (!top || baseLang(top.language) === baseLang(targetLang)) {
    mismatchStreak = 0;
    return true;
  }
  if (++mismatchStreak >= 2 && !mismatchWarned) {
    mismatchWarned = true;
    const ui = chrome.i18n.getUILanguage();
    toAllFrames(tabId, {
      type: "status",
      text: t("wrongLanguage", languageName(baseLang(top.language), ui), languageName(baseLang(targetLang), ui)),
      error: true,
    });
  }
  return false;
}

// Sound descriptions such as "[music]", "(laughs)" or "♪" aren't speech: nothing to show or translate.
function spokenText(text) {
  return text.replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]|>>/g, " ").replace(/\s+/g, " ").trim();
}

// Lines are built from pieces. Chrome's recognizer ends results after two or three words, and
// YouTube's auto-generated captions roll in word by word and wrap at the player's width. Pieces are
// joined into sentences: a line is shown when it ends a sentence, when the speaker pauses, or when it
// gets long. Ready-made subtitle cues are lines already and skip this.
const PAUSE_MS = { speech: 600, page: 1200 };
const MAX_WORDS = { speech: 16, page: 22 };
const MIN_SENTENCE_WORDS = 3;
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const SILENCE_MS = 1000; // after this long without speech the overlay lets its line go
let pending = { text: "", source: "speech" };
let pendingTimer;
let silenceTimer;

let videoPaused = false;

function onSilence(tabId, ms = SILENCE_MS) {
  clearTimeout(silenceTimer);
  if (videoPaused) return; // a paused video is silent, but its line should stay to be read
  silenceTimer = setTimeout(() => toAllFrames(tabId, { type: "clear" }), ms);
}

// Pausing holds the line on screen; playing again lets it go after the usual silence.
function onPlayback(tabId, paused) {
  videoPaused = paused;
  toAllFrames(tabId, { type: "hold", on: paused });
  if (paused) clearTimeout(silenceTimer);
  else onSilence(tabId);
}

const words = (text) => text.split(/\s+/).filter(Boolean);
const bare = (word) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

// Appends a piece, dropping the words it repeats from the end of the text so far (rolling captions
// repeat a word or two when a line wraps).
function joinPieces(text, piece) {
  if (!text) return piece;
  const a = words(text);
  const b = words(piece);
  for (let k = Math.min(4, a.length, b.length); k > 0; k--) {
    if (a.slice(-k).map(bare).join(" ") === b.slice(0, k).map(bare).join(" ")) return [...a, ...b.slice(k)].join(" ");
  }
  return `${text} ${piece}`;
}

function flushPending(tabId) {
  clearTimeout(pendingTimer);
  const { text, source } = pending;
  pending = { text: "", source };
  if (text) showCaption(tabId, text, source);
}

// The text up to the first sentence end that leaves at least a few words, and the rest after it
// ("Yeah." alone is too short to be a line, so it stays with what follows).
function splitFinished(text) {
  const ends = /[.!?…]["'”’)\]]*(?=\s+\S)/g;
  for (let m; (m = ends.exec(text)); ) {
    const head = text.slice(0, m.index + m[0].length);
    if (words(head).length >= MIN_SENTENCE_WORDS) return [head, text.slice(head.length).trim()];
  }
  return null;
}

function queuePiece(tabId, piece, source) {
  // ">>" marks a new speaker in auto-generated captions: the line so far ends there.
  piece.split(/\s*>>\s*/).forEach((part, i) => {
    if (i > 0) flushPending(tabId);
    if (part.trim()) pending = { text: joinPieces(pending.text, part.trim()), source };
  });
  // Finished sentences followed by the start of the next go out now; the rest waits for more.
  for (let parts; (parts = splitFinished(pending.text)); ) {
    pending.text = parts[1];
    showCaption(tabId, parts[0], source);
  }
  clearTimeout(pendingTimer);
  const count = words(pending.text).length;
  if (!count) return;
  if ((SENTENCE_END.test(pending.text) && count >= MIN_SENTENCE_WORDS) || count >= MAX_WORDS[source]) flushPending(tabId);
  else pendingTimer = setTimeout(() => flushPending(tabId), PAUSE_MS[source]);
}

async function onCaption(rawText, final, source, rolling = false) {
  const capture = await getCapture();
  if (!capture) return;
  const { tabId } = capture;
  if (source === "page") {
    if (!final) return;
    pageCaptionAt = Date.now();
    clearTimeout(silenceTimer); // the site's line is on screen until it says otherwise
    if (capture.speech) {
      setSpeechListening(false);
      clearTimeout(resumeSpeechTimer);
      resumeSpeechTimer = setTimeout(() => setSpeechListening(true), PAGE_CAPTION_HOLD_MS);
    }
    if (rolling) {
      queuePiece(tabId, rawText, "page");
    } else {
      flushPending(tabId);
      await showCaption(tabId, rawText, "page");
    }
    return;
  }
  if (Date.now() - pageCaptionAt < PAGE_CAPTION_HOLD_MS) return;
  // Any recognition result, finished or not, means someone is still talking.
  onSilence(tabId);
  if (!final) {
    // Still talking: give the line being built more time.
    if (pending.text) {
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => flushPending(tabId), PAUSE_MS[pending.source]);
    }
    return;
  }
  queuePiece(tabId, rawText, "speech");
}

async function showCaption(tabId, rawText, source) {
  if ((await getCapture())?.tabId !== tabId) return;
  const text = spokenText(rawText);
  if (!/\p{L}/u.test(text)) return;
  if (!(await inLearningLanguage(text, tabId))) return;
  if (text === lastFinal) return; // same cue reported twice (re-render, two frames)
  lastFinal = text;
  toAllFrames(tabId, { type: "caption", text, source });
  await onFinalCaption(text);
}

async function onFinalCaption(text) {
  const { quizMinutes } = await getSettings();
  const { due, watched } = await updateProgress((p) => {
    const now = Date.now();
    const gap = p.lastFinalAt ? now - p.lastFinalAt : 0;
    const watched = gap > 0 && gap < MAX_GAP_MS ? gap : 0;
    p.segmentMs += watched;
    p.lastFinalAt = now;
    p.lines.push(text);
    return { due: p.segmentMs >= quizMinutes * 60000 && p.lines.length >= MIN_QUIZ_LINES, watched };
  });
  await recordActivity({ ms: watched, lines: 1 });
  if (due) runQuiz();
}

async function onSpeechError(code, detail) {
  const error = t(`speech_${code}`, detail ?? "");
  const capture = await getCapture();
  if (capture?.source === "auto") {
    // Site subtitles can still carry the session.
    await closeOffscreen();
    await setCapture({ ...capture, speech: false });
    toAllFrames(capture.tabId, { type: "status", text: t("speechFallback", error), error: true });
  } else {
    await stopCaptions(error);
  }
}

// ---- translation (cached; live lines, prefetched cues and clicks share one request per line) ----
// Live lines are translated without notes (fewer output tokens); a click asks for the full version.
const cache = new Map(); // "provider|model|native|live-or-full|text" -> Promise<result>

const cacheKey = (settings, text, withNotes) =>
  [settings.provider, settings.model, settings.nativeLang, withNotes ? "full" : "live", text].join("|");

function remember(key, promise) {
  cache.set(key, promise);
  promise.catch(() => cache.delete(key)); // a failed line is asked for again next time
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return promise;
}

async function translateCached(text, context = "", withNotes = false) {
  const settings = await getSettings();
  const key = cacheKey(settings, text, withNotes);
  return cache.get(key) ?? remember(key, translateLine(text, context, settings, { withNotes }));
}

// The last lines heard, as context for a translation.
async function recentContext(text) {
  const { progress } = await chrome.storage.local.get("progress");
  const lines = progress?.lines || [];
  const idx = text == null ? lines.length : lines.lastIndexOf(text);
  return (idx > 0 ? lines.slice(Math.max(0, idx - 2), idx) : []).join("\n");
}

async function markStruggled(text) {
  const added = await updateProgress((p) => {
    if (p.clicked.includes(text)) return false;
    p.clicked.push(text);
    return true;
  });
  if (added) await recordActivity({ lookedUp: 1 });
}

async function handleTranslate(text, live) {
  if (!live) await markStruggled(text);
  const context = await recentContext(text);
  try {
    return { ok: true, ...(await translateCached(text, context, !live)) };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

// Upcoming subtitle cues are translated together in one request: the instructions, most of each
// request, are sent once for several lines. It waits until the cues ready ahead run low, so every
// request carries a handful of lines. Lines that are only translated when asked for skip this.
async function prefetch(texts) {
  const settings = await getSettings();
  if (!settings.key || settings.trMode === "click" || (settings.trMode === "blur" && settings.lazyTranslate)) return;
  const upcoming = [...new Set(texts.map(spokenText).filter((t) => /\p{L}/u.test(t)))];
  const missing = upcoming.filter((text) => !cache.has(cacheKey(settings, text, false)));
  if (!upcoming.slice(0, PREFETCH_LOW).some((text) => missing.includes(text))) return;
  const batch = translateBatch(missing, await recentContext(), settings);
  batch.catch(() => {});
  missing.forEach((text, i) => remember(cacheKey(settings, text, false), batch.then((items) => items[i])).catch(() => {}));
}

// ---- word pool: lines saved from the translation card, newest first ----
const wordKey = (w) => `${baseLang(w.lang)}|${w.text}`;
const str = (value, max) => String(value ?? "").slice(0, max);

// Saves the line, or removes it if it's already saved. An undone removal keeps its date and place.
function toggleWord(input) {
  const word = {
    text: str(input.text, 500),
    translation: str(input.translation, 1000),
    notes: (Array.isArray(input.notes) ? input.notes : [])
      .slice(0, 5)
      .map((n) => ({ phrase: str(n?.phrase, 200), meaning: str(n?.meaning, 500) })),
    lang: str(input.lang, 20),
    url: /^https?:/.test(input.url) ? str(input.url, 2000) : "",
    savedAt: Number(input.savedAt) || Date.now(),
  };
  if (!word.text || !word.lang) return { saved: false };
  return updateStore("words", () => [], (words) => {
    const at = words.findIndex((w) => wordKey(w) === wordKey(word));
    if (at >= 0) {
      words.splice(at, 1);
      return { saved: false };
    }
    const place = words.findIndex((w) => w.savedAt < word.savedAt);
    words.splice(place < 0 ? words.length : place, 0, word);
    words.length = Math.min(words.length, WORDS_MAX);
    return { saved: true };
  });
}

// ---- quiz ----
let quizRunning = false;

// Every quiz is kept in a history, newest first, and opened on its own page.
async function saveQuiz(quiz, extra) {
  const id = crypto.randomUUID();
  await updateStore("quizzes", () => [], (quizzes) => {
    quizzes.unshift({ ...quiz, ...extra, id, answers: [], createdAt: Date.now() });
    quizzes.length = Math.min(quizzes.length, QUIZZES_MAX);
  });
  await recordActivity({ quizzes: 1 });
  await chrome.tabs.create({ url: `quiz.html?id=${id}` });
}

// Versions before 0.8 kept only the latest quiz, under "quiz".
async function migrateQuiz() {
  const { quiz } = await chrome.storage.local.get("quiz");
  if (!quiz?.questions) return;
  await updateStore("quizzes", () => [], (quizzes) => void quizzes.push({ ...quiz, id: crypto.randomUUID() }));
  await chrome.storage.local.remove("quiz");
}

// A quiz on a random handful of lines from the word pool, in the language being learned.
async function runWordQuiz() {
  if (quizRunning) return { ok: false, error: t("quizAlreadyRunning") };
  quizRunning = true;
  try {
    const settings = await getSettings();
    const { words = [] } = await chrome.storage.local.get("words");
    const pool = words.filter((w) => baseLang(w.lang) === baseLang(settings.targetLang));
    if (pool.length < WORD_QUIZ_MIN) throw new Error(t("wordQuizNotEnough", WORD_QUIZ_MIN));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const quiz = await generateWordQuiz(pool.slice(0, WORD_QUIZ_PICK), settings);
    await saveQuiz(quiz, { from: "words", sourceTabId: null });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  } finally {
    quizRunning = false;
  }
}

// Drops what was collected toward the next quiz: watch time, transcript and looked-up lines.
const resetQuiz = () => updateProgress((p) => void Object.assign(p, emptyProgress()));

// The video a page plays, from its address: the hash and parameters for the playback position,
// playlist place or tracking don't make it another video (YouTube's ?v= does).
const POSITION_PARAMS = /^(t|start|time_continue|index|pp|si|feature|utm_.*)$/;
function videoKey(url) {
  try {
    const u = new URL(url);
    const params = [...u.searchParams].filter(([name]) => !POSITION_PARAMS.test(name)).sort();
    return `${u.origin}${u.pathname}?${new URLSearchParams(params)}`;
  } catch {
    return "";
  }
}
async function runQuiz() {
  if (quizRunning) return { ok: false, error: t("quizAlreadyRunning") };
  quizRunning = true;
  const capture = await getCapture();
  // Take this segment's transcript and start a fresh segment right away.
  const snapshot = await updateProgress((p) => {
    const taken = { lines: p.lines, clicked: p.clicked };
    Object.assign(p, emptyProgress());
    return taken;
  });
  try {
    if (snapshot.lines.length < 3) throw new Error(t("quizNotEnough"));
    if (capture) toAllFrames(capture.tabId, { type: "status", text: t("quizPreparing") });
    const quiz = await generateQuiz(snapshot.lines, snapshot.clicked, await getSettings());
    // The video's page title names the quiz in the history.
    const tab = capture && (await chrome.tabs.get(capture.tabId).catch(() => null));
    if (capture) toAllFrames(capture.tabId, { type: "media", action: "pause" });
    await saveQuiz(quiz, {
      from: "video",
      title: tab?.title?.slice(0, 200) || "",
      url: /^https?:/.test(tab?.url) ? tab.url : "",
      sourceTabId: capture?.tabId ?? null,
    });
    return { ok: true };
  } catch (err) {
    // Put the transcript back so nothing is lost.
    await updateProgress((p) => {
      p.lines = snapshot.lines.concat(p.lines);
      p.clicked = snapshot.clicked.concat(p.clicked);
    });
    const error = friendlyError(err);
    if (capture) toAllFrames(capture.tabId, { type: "status", text: t("quizError", error), error: true });
    return { ok: false, error };
  } finally {
    quizRunning = false;
  }
}

async function getState() {
  const [capture, settings, { progress }] = await Promise.all([
    getCapture(),
    getSettings(),
    chrome.storage.local.get("progress"),
  ]);
  const p = progress || emptyProgress();
  return {
    activeTabId: capture?.tabId ?? null,
    hasKey: Boolean(settings.key),
    quizMinutes: settings.quizMinutes,
    watchedMs: p.segmentMs,
    lineCount: p.lines.length,
    struggledCount: p.clicked.length,
    quizRunning,
  };
}

// Stores a quiz answer once (reloading the quiz page can't count it twice) and adds it to today's activity.
async function answerQuiz(id, index, choice) {
  const correct = await updateStore("quizzes", () => [], (quizzes) => {
    const quiz = quizzes.find((q) => q.id === id);
    if (!quiz?.questions[index] || quiz.answers?.[index] != null) return null;
    (quiz.answers ??= [])[index] = choice;
    return quiz.questions[index].correct_index === choice;
  });
  if (correct != null) await recordActivity(correct ? { correct: 1 } : { wrong: 1 });
}

async function handleListModels(provider, key) {
  try {
    return { ok: true, models: await listModels({ ...(await getSettings()), provider, key }) };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

// Messages from the captioned tab only count while that tab is being captioned.
async function fromCapturedTab(sender) {
  return sender.tab && (await getCapture())?.tabId === sender.tab.id;
}

const handlers = {
  // popup
  start: (msg) => startCaptions(msg.tabId, msg.streamId).then(() => ({ ok: true })),
  stop: () => stopCaptions().then(() => ({ ok: true })),
  getState: () => getState(),
  quizNow: () => runQuiz(),
  resetQuiz: () => resetQuiz().then(() => ({ ok: true })),
  // options.js / quiz.js
  listModels: (msg) => handleListModels(msg.provider, msg.key),
  quizAnswer: (msg) => answerQuiz(msg.id, msg.index, msg.choice),
  // overlay.js (the card) / words.js
  toggleWord: (msg) => toggleWord(msg.word || {}),
  wordQuiz: () => runWordQuiz(),
  // overlay.js / reader.js
  translate: (msg) => handleTranslate(msg.text, msg.live),
  prefetch: async (msg, sender) => (await fromCapturedTab(sender)) && prefetch(msg.texts),
  struggled: async (msg, sender) => (await fromCapturedTab(sender)) && markStruggled(msg.text),
  media: (msg, sender) => sender.tab && toAllFrames(sender.tab.id, { type: "media", action: msg.action }),
  pageCaption: async (msg, sender) =>
    (await fromCapturedTab(sender)) && onCaption(msg.text, msg.final, "page", msg.rolling),
  framesChanged: async (msg, sender) => (await fromCapturedTab(sender)) && injectScripts(sender.tab.id).catch(() => {}),
  playback: async (msg, sender) => (await fromCapturedTab(sender)) && onPlayback(sender.tab.id, msg.paused),
  pageClear: async (msg, sender) => (await fromCapturedTab(sender)) && onSilence(sender.tab.id),
  // offscreen.js
  caption: (msg) => onCaption(msg.text, msg.final, "speech"),
  captionError: (msg) => onSpeechError(msg.code, msg.detail),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === "offscreen") return false;
  const handler = handlers[msg.type];
  if (!handler) return false;
  Promise.resolve(handler(msg, sender))
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: friendlyError(err) }));
  return true;
});

// A new learning language applies to the running session right away.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes.targetLang) return;
  const capture = await getCapture();
  if (!capture) return;
  lastFinal = "";
  mismatchStreak = 0;
  mismatchWarned = false;
  const lang = changes.targetLang.newValue;
  if (capture.speech) chrome.runtime.sendMessage({ target: "offscreen", type: "setLang", lang }).catch(() => {});
  toAllFrames(capture.tabId, { type: "status", text: t("languageSwitched", languageName(lang, chrome.i18n.getUILanguage())) });
});

// First install: walk through setup.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) chrome.tabs.create({ url: "onboarding.html" });
  else migrateQuiz();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getCapture())?.tabId === tabId) await stopCaptions();
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  const capture = await getCapture();
  if (capture?.tabId !== tabId) return;
  // Another video in the captioned tab: the quiz starts over, so it doesn't mix the two.
  const video = info.url && videoKey(info.url);
  if (video && capture.video && video !== capture.video) {
    await setCapture({ ...capture, video });
    await resetQuiz();
    toAllFrames(tabId, { type: "status", text: t("quizResetNewVideo") });
  }
  // A full page load wipes the injected scripts; tab capture keeps running, so put them back.
  if (info.status === "complete") injectScripts(tabId).catch(() => stopCaptions());
});
