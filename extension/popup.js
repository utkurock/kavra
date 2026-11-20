const { t, getSettings, languageName, localizePage } = globalThis.Kavra;
const $ = (id) => document.getElementById(id);
let currentTabId;
let state;
let source = "auto";

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}

async function refresh() {
  state = await chrome.runtime.sendMessage({ type: "getState" });
  const onThisTab = state.activeTabId === currentTabId;
  $("status").textContent = onThisTab ? t("statusOnHere") : state.activeTabId ? t("statusOnOther") : t("statusOff");
  $("toggle").textContent = onThisTab ? t("stopCaptions") : t("startCaptions");
  $("noKey").hidden = state.hasKey;

  const watchedMin = Math.floor(state.watchedMs / 60000);
  $("quizInfo").textContent = state.quizRunning
    ? t("quizPreparing")
    : t("quizProgress", watchedMin, state.quizMinutes, state.lineCount);
  $("quizBar").value = Math.min(1, state.watchedMs / (state.quizMinutes * 60000));
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
  $("quizInfo").textContent = t("quizPreparing");
  const res = await chrome.runtime.sendMessage({ type: "quizNow" });
  if (!res?.ok) showError(res?.error || t("quizFailed"));
  refresh();
});

$("trMode").addEventListener("change", () => chrome.storage.local.set({ trMode: $("trMode").value }));
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

(async () => {
  localizePage();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  const settings = await getSettings();
  $("trMode").value = settings.trMode;
  source = settings.source;
  const ui = chrome.i18n.getUILanguage();
  $("pair").textContent = `${languageName(settings.targetLang, ui)} → ${languageName(settings.nativeLang, ui)}`;
  await refresh();
})();
