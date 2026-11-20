const { t, getSettings, languageName, baseLang, localizePage, TARGET_LOCALES, NATIVE_LANGS, LEVELS } = globalThis.Kavra;
const $ = (id) => document.getElementById(id);
const ALL_SITES = { origins: ["<all_urls>"] };
const FIELDS = ["targetLang", "nativeLang", "level", "source", "trMode", "quizMinutes"];
const ui = chrome.i18n.getUILanguage();

function fillSelect(select, codes, label) {
  const options = codes.map((code) => [code, label(code)]).sort((a, b) => a[1].localeCompare(b[1], ui));
  for (const [value, text] of options) select.add(new Option(text, value));
}

async function showFramesPermission() {
  const granted = await chrome.permissions.contains(ALL_SITES);
  $("framesPerm").textContent = granted ? t("framesGranted") : t("framesGrant");
  $("framesPerm").dataset.granted = granted;
}

$("framesPerm").addEventListener("click", async () => {
  if ($("framesPerm").dataset.granted === "true") await chrome.permissions.remove(ALL_SITES);
  else await chrome.permissions.request(ALL_SITES);
  showFramesPermission();
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (baseLang($("targetLang").value) === $("nativeLang").value) {
    $("saved").textContent = t("sameLanguage");
    return;
  }
  const quizMinutes = Math.min(180, Math.max(3, Math.round(Number($("quizMinutes").value) || 20)));
  $("quizMinutes").value = quizMinutes;
  const values = Object.fromEntries(FIELDS.map((f) => [f, $(f).value]));
  await chrome.storage.local.set({ ...values, quizMinutes, apiKey: $("apiKey").value.trim() });
  $("saved").textContent = t("saved");
});

(async () => {
  localizePage();
  // Native language names ("Deutsch") next to the UI-language name help people find their language.
  const label = (code) => {
    const own = languageName(code, code);
    const local = languageName(code, ui);
    return own === local ? local : `${local} — ${own}`;
  };
  fillSelect($("targetLang"), TARGET_LOCALES, label);
  fillSelect($("nativeLang"), NATIVE_LANGS, label);
  for (const level of LEVELS) $("level").add(new Option(level, level));

  const s = await getSettings();
  for (const f of FIELDS) $(f).value = s[f];
  $("apiKey").value = s.apiKey || "";
  showFramesPermission();
})();
