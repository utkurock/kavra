// Service worker: owns capture state, picks the caption source, routes captions to the page,
// and runs translation and quizzes.
import "../extension/settings.js";
import { translateLine, generateQuiz, listModels, friendlyError } from "./llm.js";

const { getSettings, t, dayKey, baseLang, languageName } = globalThis.Kavra;
const MAX_GAP_MS = 30000; // silence longer than this does not count as watch time
const MIN_QUIZ_LINES = 8;
const PAGE_CAPTION_HOLD_MS = 15000; // after a site caption, ignore speech recognition this long
const CACHE_SIZE = 400;
const ACTIVITY_DAYS = 400; // days of history kept for the activity view

// ---- persistent state ----
// session "capture": { tabId, speech, source } for the tab being captioned (cleared on browser restart).
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
  await setCapture({ tabId, speech: Boolean(streamId), source });
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
  pendingSpeech = "";
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
  return text.replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, " ").replace(/\s+/g, " ").trim();
}

// Chrome's recognizer often ends a result after two or three words. Pieces that follow each other
// closely are joined into one line, which is shown once the speaker pauses or the line gets long.
const MERGE_PAUSE_MS = 600;
const MERGE_MAX_WORDS = 10;
const SILENCE_MS = 1000; // after this long without speech the overlay lets its line go
let pendingSpeech = "";
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

function flushSpeech(tabId) {
  clearTimeout(pendingTimer);
  const text = pendingSpeech;
  pendingSpeech = "";
  if (text) showCaption(tabId, text, "speech");
}

async function onCaption(rawText, final, source) {
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
    await showCaption(tabId, rawText, "page");
    return;
  }
  if (Date.now() - pageCaptionAt < PAGE_CAPTION_HOLD_MS) return;
  // Any recognition result, finished or not, means someone is still talking.
  onSilence(tabId);
  if (!final) {
    if (pendingSpeech) {
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => flushSpeech(tabId), MERGE_PAUSE_MS);
    }
    return;
  }
  pendingSpeech = pendingSpeech ? `${pendingSpeech} ${rawText}` : rawText;
  clearTimeout(pendingTimer);
  if (pendingSpeech.split(/\s+/).length >= MERGE_MAX_WORDS) flushSpeech(tabId);
  else pendingTimer = setTimeout(() => flushSpeech(tabId), MERGE_PAUSE_MS);
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

async function translateCached(text, context = "", withNotes = false) {
  const settings = await getSettings();
  const key = [settings.provider, settings.model, settings.nativeLang, withNotes ? "full" : "live", text].join("|");
  if (cache.has(key)) return cache.get(key);
  const promise = translateLine(text, context, settings, { withNotes });
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return promise;
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
  const { progress } = await chrome.storage.local.get("progress");
  const lines = progress?.lines || [];
  const idx = lines.lastIndexOf(text);
  const context = (idx > 0 ? lines.slice(Math.max(0, idx - 2), idx) : []).join("\n");
  try {
    return { ok: true, ...(await translateCached(text, context, !live)) };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

async function prefetch(texts) {
  if (!(await getSettings()).key) return;
  for (const text of texts.map(spokenText).filter((t) => /\p{L}/u.test(t))) translateCached(text).catch(() => {});
}

// ---- quiz ----
let quizRunning = false;
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
    await chrome.storage.local.set({
      quiz: { ...quiz, answers: [], createdAt: Date.now(), sourceTabId: capture?.tabId ?? null },
    });
    await recordActivity({ quizzes: 1 });
    if (capture) toAllFrames(capture.tabId, { type: "media", action: "pause" });
    await chrome.tabs.create({ url: "quiz.html" });
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
async function answerQuiz(index, choice) {
  const correct = await updateStore("quiz", () => null, (quiz) => {
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
  // options.js / quiz.js
  listModels: (msg) => handleListModels(msg.provider, msg.key),
  quizAnswer: (msg) => answerQuiz(msg.index, msg.choice),
  // overlay.js / reader.js
  translate: (msg) => handleTranslate(msg.text, msg.live),
  prefetch: async (msg, sender) => (await fromCapturedTab(sender)) && prefetch(msg.texts),
  struggled: async (msg, sender) => (await fromCapturedTab(sender)) && markStruggled(msg.text),
  media: (msg, sender) => sender.tab && toAllFrames(sender.tab.id, { type: "media", action: msg.action }),
  pageCaption: async (msg, sender) => (await fromCapturedTab(sender)) && onCaption(msg.text, msg.final, "page"),
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
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getCapture())?.tabId === tabId) await stopCaptions();
});

// A full page load wipes the injected scripts; tab capture keeps running, so put them back.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete" || (await getCapture())?.tabId !== tabId) return;
  injectScripts(tabId).catch(() => stopCaptions());
});
