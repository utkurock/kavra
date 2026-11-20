// Service worker: owns capture state, picks the caption source, routes captions to the page,
// and runs translation and quizzes.
import "../extension/settings.js";
import { translateLine, generateQuiz, listModels, friendlyError } from "./llm.js";

const { getSettings, t, dayKey } = globalThis.Kavra;
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
function toTop(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => {}); // tab may be reloading
}
function toAllFrames(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

async function injectScripts(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["settings.js", "overlay.js"] });
  // Players in cross-origin iframes are readable only with the optional all-sites permission.
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, files: ["settings.js", "reader.js"] })
    .catch(() => chrome.scripting.executeScript({ target: { tabId }, files: ["settings.js", "reader.js"] }));
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
  toTop(tabId, {
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

async function onCaption(text, final, source) {
  const capture = await getCapture();
  if (!capture) return;
  if (source === "page") {
    pageCaptionAt = Date.now();
    if (capture.speech) {
      setSpeechListening(false);
      clearTimeout(resumeSpeechTimer);
      resumeSpeechTimer = setTimeout(() => setSpeechListening(true), PAGE_CAPTION_HOLD_MS);
    }
  } else if (Date.now() - pageCaptionAt < PAGE_CAPTION_HOLD_MS) {
    return;
  }
  if (final) {
    if (text === lastFinal) return; // same cue reported twice (re-render, two frames)
    lastFinal = text;
  }
  toTop(capture.tabId, { type: "caption", text, final });
  if (final) await onFinalCaption(text);
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
    toTop(capture.tabId, { type: "status", text: t("speechFallback", error), error: true });
  } else {
    await stopCaptions(error);
  }
}

// ---- translation (cached; live lines, prefetched cues and clicks share one request per line) ----
const cache = new Map(); // "provider|model|native|text" -> Promise<result>

async function translateCached(text, context = "") {
  const settings = await getSettings();
  const key = [settings.provider, settings.model, settings.nativeLang, text].join("|");
  if (cache.has(key)) return cache.get(key);
  const promise = translateLine(text, context, settings);
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
  const context = (idx > 0 ? lines.slice(Math.max(0, idx - 3), idx) : []).join("\n");
  try {
    return { ok: true, ...(await translateCached(text, context)) };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

async function prefetch(texts) {
  if (!(await getSettings()).key) return;
  for (const text of texts) translateCached(text).catch(() => {});
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
    if (capture) toTop(capture.tabId, { type: "status", text: t("quizPreparing") });
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
    if (capture) toTop(capture.tabId, { type: "status", text: t("quizError", error), error: true });
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
