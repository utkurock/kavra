const { t, getSettings, languageName, baseLang, fillLanguageSelect, localizePage, TARGET_LOCALES, NATIVE_LANGS, PROVIDERS } =
  globalThis.Kavra;
const { summarize, waveform } = globalThis.KavraCharts;
const $ = (id) => document.getElementById(id);
const MODE_HINT = { blur: "trModeBlur", always: "trModeAlways", click: "trModeClick" };
const ui = chrome.i18n.getUILanguage();
let currentTabId;
let supported = true; // false on pages Chrome doesn't let extensions touch (chrome://, the Web Store, other extensions)
let onboarded = true;
let state;
let source = "auto";

// ---- notices: one slot keeps the overview from growing; an error wins, then setup, then a missing key ----
let errorText = "";
let noticeAction = null;
function showNotice() {
  const notice = errorText
    ? { kind: "bad", text: errorText }
    : !onboarded
      ? { kind: "warn", text: t("setupWarning"), action: t("startSetup"), run: openOnboarding }
      : state && !state.hasKey
        ? { kind: "warn", text: t("noKeyWarning"), action: t("addKey"), run: () => openKeySheet($("noticeAction")) }
        : null;
  $("notice").hidden = !notice;
  if (!notice) return;
  $("notice").className = `callout ${notice.kind}`;
  $("noticeText").textContent = notice.text;
  $("noticeAction").hidden = !notice.action;
  $("noticeAction").textContent = notice.action || "";
  noticeAction = notice.run;
}
$("noticeAction").addEventListener("click", () => noticeAction?.());
function openOnboarding() {
  chrome.tabs.create({ url: "onboarding.html" });
  window.close();
}
function showError(text) {
  errorText = text;
  showNotice();
}

// ---- tabs ----
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const other of tabs) {
    const selected = other === tab;
    other.ariaSelected = selected;
    other.tabIndex = selected ? 0 : -1;
    $(other.getAttribute("aria-controls")).inert = !selected;
  }
}
for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = tabs[(tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next);
    next.focus();
  });
}

// ---- overview ----
function showPair(settings) {
  $("pair").textContent = `${languageName(baseLang(settings.targetLang), ui)} → ${languageName(settings.nativeLang, ui)}`;
  $("pair").title =
    `${t("targetLangLabel")}: ${languageName(settings.targetLang, ui)} · ` +
    `${t("nativeLangLabel")}: ${languageName(settings.nativeLang, ui)}`;
}

async function refresh() {
  state = await chrome.runtime.sendMessage({ type: "getState" });
  const onThisTab = state.activeTabId === currentTabId;
  $("toggle").ariaChecked = onThisTab;
  $("toggle").disabled = !supported && !onThisTab;
  $("power").classList.toggle("on", onThisTab);
  $("powerSub").textContent = onThisTab
    ? t("subOnHere")
    : !supported
      ? t("subUnsupported")
      : state.activeTabId
        ? t("subOnOther")
        : t("subOff");
  showNotice();

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

// ---- sheets: panels over the tabs for quick edits without leaving the popup ----
const panels = [...document.querySelectorAll(".panel")];
let openSheetState = null;
function openSheet(sheet, focus, returnFocus) {
  openSheetState = { sheet, returnFocus, inert: panels.map((panel) => panel.inert) };
  for (const panel of panels) panel.inert = true;
  sheet.hidden = false;
  focus.focus();
}
function closeSheet() {
  if (!openSheetState) return;
  const { sheet, returnFocus, inert } = openSheetState;
  openSheetState = null;
  sheet.hidden = true;
  panels.forEach((panel, i) => (panel.inert = inert[i]));
  returnFocus.focus();
}
for (const sheet of document.querySelectorAll(".sheet")) {
  sheet.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || (sheet.id === "langSheet" && !sheetValid())) return;
    e.preventDefault(); // keep the popup open
    closeSheet();
  });
}

// ---- language sheet ----
function sheetValid() {
  const same = baseLang($("sheetTarget").value) === $("sheetNative").value;
  $("sheetError").hidden = !same;
  $("sheetDone").disabled = same;
  return !same;
}
async function saveSheet(field, value) {
  if (!sheetValid()) return;
  await chrome.storage.local.set({ [field]: value });
  showPair(await getSettings());
}
$("changeLang").addEventListener("click", () => openSheet($("langSheet"), $("sheetTarget"), $("changeLang")));
$("sheetDone").addEventListener("click", closeSheet);
$("sheetTarget").addEventListener("change", () => saveSheet("targetLang", $("sheetTarget").value));
$("sheetNative").addEventListener("change", () => saveSheet("nativeLang", $("sheetNative").value));

// ---- API key sheet: pick a provider and paste its key ----
let keySettings;
function showKeyProvider(id) {
  const provider = PROVIDERS[id];
  $("keyProvider").value = id;
  $("keyInput").value = keySettings.apiKeys[id] || "";
  $("keyInput").placeholder = provider.keyHint;
  $("keyLink").href = provider.keyUrl;
}
async function showProviderRow() {
  keySettings = await getSettings();
  $("providerName").textContent = PROVIDERS[keySettings.provider].name;
  $("keyState").textContent = ` · ${t(keySettings.key ? "keyAdded" : "keyMissing")}`;
}
async function openKeySheet(returnFocus) {
  if (!keySettings) await showProviderRow();
  showKeyProvider(keySettings.provider);
  openSheet($("keySheet"), $("keyInput"), returnFocus);
}
$("keyProvider").addEventListener("change", () => showKeyProvider($("keyProvider").value));
$("keyToggle").addEventListener("click", () => {
  const hidden = $("keyInput").type === "password";
  $("keyInput").type = hidden ? "text" : "password";
  $("keyToggle").textContent = hidden ? t("hide") : t("show");
});
$("keyCancel").addEventListener("click", closeSheet);
$("keySave").addEventListener("click", async () => {
  const provider = $("keyProvider").value;
  await chrome.storage.local.remove("apiKey"); // single key stored by versions before 0.6
  await chrome.storage.local.set({
    provider,
    apiKeys: { ...keySettings.apiKeys, [provider]: $("keyInput").value.trim() },
  });
  closeSheet();
  await Promise.all([showProviderRow(), refresh()]);
});
$("keyInput").addEventListener("keydown", (e) => e.key === "Enter" && $("keySave").click());
$("changeKey").addEventListener("click", () => openKeySheet($("changeKey")));

// ---- activity ----
async function showActivity() {
  const { activity = {} } = await chrome.storage.local.get("activity");
  const sum = summarize(activity);
  $("actToday").textContent = Math.round(sum.today.ms / 60000);
  $("actStreak").textContent = sum.streak;
  $("actAccuracy").textContent = sum.accuracy == null ? "–" : `${sum.accuracy}%`;
  const start = waveform($("wave"), activity, {
    count: 30,
    tooltip: (date, day) =>
      t("dayTooltip", date.toLocaleDateString(ui, { day: "numeric", month: "short" }), Math.round(day.ms / 60000), day.correct, day.wrong),
  });
  $("waveStart").textContent = start.toLocaleDateString(ui, { day: "numeric", month: "short" });
  $("wave").ariaLabel = t("activityLabel", Math.round(sum.ms / 60000), sum.activeDays);
}

// ---- preferences ----
function showMode(mode) {
  $(`m-${mode}`).checked = true;
  $("trModeHint").textContent = t(MODE_HINT[mode]);
}
for (const input of document.querySelectorAll('input[name="trMode"]')) {
  input.addEventListener("change", () => {
    showMode(input.value);
    chrome.storage.local.set({ trMode: input.value });
  });
}
// Subtitles dragged on the video keep their spot until reset here.
async function showPosition() {
  const { overlayPos } = await chrome.storage.local.get("overlayPos");
  const custom = overlayPos != null;
  $("posState").textContent = t(custom ? "posCustom" : "posAuto");
  $("resetPos").hidden = !custom;
}
$("resetPos").addEventListener("click", async () => {
  await chrome.storage.local.set({ overlayPos: null });
  showPosition();
});
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

(async () => {
  localizePage();
  $("version").textContent = chrome.runtime.getManifest().version;
  fillLanguageSelect($("sheetTarget"), TARGET_LOCALES);
  fillLanguageSelect($("sheetNative"), NATIVE_LANGS);
  for (const [id, provider] of Object.entries(PROVIDERS)) $("keyProvider").add(new Option(provider.name, id));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  // Chrome hides the URL of pages extensions can't touch, so ask it directly: try a no-op script.
  supported = await chrome.scripting
    .executeScript({ target: { tabId: currentTabId }, func: () => true })
    .then(() => true, () => false);
  const settings = await getSettings();
  onboarded = settings.onboarded;
  showMode(settings.trMode);
  source = settings.source;
  showPair(settings);
  $("sheetTarget").value = settings.targetLang;
  $("sheetNative").value = settings.nativeLang;
  await Promise.all([refresh(), showActivity(), showProviderRow(), showPosition()]);
})();
