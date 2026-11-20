const { t, getSettings, languageName, baseLang, localizePage } = globalThis.Kavra;
const $ = (id) => document.getElementById(id);
const MODE_HINT = { blur: "trModeBlur", always: "trModeAlways", click: "trModeClick" };
let currentTabId;
let state;
let source = "auto";

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}

function showMode(mode) {
  $(`m-${mode}`).checked = true;
  $("trModeHint").textContent = t(MODE_HINT[mode]);
}

async function refresh() {
  state = await chrome.runtime.sendMessage({ type: "getState" });
  const onThisTab = state.activeTabId === currentTabId;
  $("status").classList.toggle("on", onThisTab);
  $("statusText").textContent = onThisTab ? t("pillLive") : state.activeTabId ? t("pillOther") : t("pillOff");
  $("toggle").textContent = onThisTab ? t("stopCaptions") : t("startCaptions");
  $("toggle").className = `btn block ${onThisTab ? "danger" : "primary"}`;
  $("noKey").hidden = state.hasKey;

  const watchedMin = Math.floor(state.watchedMs / 60000);
  const pct = Math.min(100, Math.round((state.watchedMs / (state.quizMinutes * 60000)) * 100));
  $("statMinutes").textContent = watchedMin;
  $("statLines").textContent = state.lineCount;
  $("statLookedUp").textContent = state.struggledCount;
  $("statQuizIn").textContent = Math.max(0, state.quizMinutes - watchedMin);
  $("statQuizLabel").textContent = state.quizRunning ? t("quizPreparing") : t("statQuizIn");
  $("quizBar").firstElementChild.style.width = `${pct}%`;
  $("quizBar").ariaValueNow = pct;
  $("quizNow").disabled = state.quizRunning || !state.hasKey || state.lineCount === 0;
}

$("toggle").addEventListener("click", async () => {
  showError("");
  $("toggle").disabled = true;
  try {
    if (state.activeTabId === currentTabId) {
      await chrome.runtime.sendMessage({ type: "stop" });
    } else {
      // Must be called here, from the user's click on the extension, to get the tab's audio.
      const streamId =
        source === "page" ? null : await chrome.tabCapture.getMediaStreamId({ targetTabId: currentTabId });
      const res = await chrome.runtime.sendMessage({ type: "start", tabId: currentTabId, streamId });
      if (!res?.ok) throw new Error(res?.error || t("startFailedGeneric"));
      window.close();
    }
  } catch (err) {
    showError(t("startFailed", err.message));
  } finally {
    $("toggle").disabled = false;
    refresh();
  }
});

$("quizNow").addEventListener("click", async () => {
  showError("");
  $("quizNow").disabled = true;
  $("statQuizLabel").textContent = t("quizPreparing");
  const res = await chrome.runtime.sendMessage({ type: "quizNow" });
  if (!res?.ok) showError(res?.error || t("quizFailed"));
  refresh();
});

for (const input of document.querySelectorAll('input[name="trMode"]')) {
  input.addEventListener("change", () => {
    showMode(input.value);
    chrome.storage.local.set({ trMode: input.value });
  });
}
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("addKey").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("changeLang").addEventListener("click", () => chrome.runtime.openOptionsPage());

(async () => {
  localizePage();
  $("version").textContent = chrome.runtime.getManifest().version;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  const settings = await getSettings();
  showMode(settings.trMode);
  source = settings.source;
  const ui = chrome.i18n.getUILanguage();
  $("pair").textContent = `${languageName(baseLang(settings.targetLang), ui)} → ${languageName(settings.nativeLang, ui)}`;
  $("pair").title = `${languageName(settings.targetLang, ui)} → ${languageName(settings.nativeLang, ui)}`;
  await refresh();
})();
