const { t, getSettings, languageName, baseLang, localizePage, TARGET_LOCALES, NATIVE_LANGS, LEVELS } = globalThis.Kavra;
const $ = (id) => document.getElementById(id);
const ALL_SITES = { origins: ["<all_urls>"] };
const SELECTS = ["targetLang", "nativeLang", "level", "source"];
const ui = chrome.i18n.getUILanguage();

let toastTimer;
function toast(text, bad = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = text;
  $("toast").classList.toggle("bad", bad);
  $("toast").classList.add("show");
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1800);
}

function fillSelect(select, codes, label) {
  const options = codes.map((code) => [code, label(code)]).sort((a, b) => a[1].localeCompare(b[1], ui));
  for (const [value, text] of options) select.add(new Option(text, value));
}

// Settings save as soon as they change.
async function save(values) {
  await chrome.storage.local.set(values);
  toast(t("savedShort"));
}

function languagesValid() {
  const same = baseLang($("targetLang").value) === $("nativeLang").value;
  $("langError").hidden = !same;
  $("nativeLang").ariaInvalid = same;
  return !same;
}

for (const id of SELECTS) {
  $(id).addEventListener("change", () => {
    if ((id === "targetLang" || id === "nativeLang") && !languagesValid()) return;
    save({ [id]: $(id).value });
  });
}

for (const input of document.querySelectorAll('input[name="trMode"]')) {
  input.addEventListener("change", () => save({ trMode: input.value }));
}

$("quizMinutes").addEventListener("change", () => {
  const quizMinutes = Math.min(180, Math.max(3, Math.round(Number($("quizMinutes").value) || 20)));
  $("quizMinutes").value = quizMinutes;
  save({ quizMinutes });
});

$("apiKey").addEventListener("change", () => save({ apiKey: $("apiKey").value.trim() }));
$("toggleKey").addEventListener("click", () => {
  const hidden = $("apiKey").type === "password";
  $("apiKey").type = hidden ? "text" : "password";
  $("toggleKey").textContent = hidden ? t("hide") : t("show");
});

$("framesPerm").addEventListener("change", async () => {
  const want = $("framesPerm").checked;
  const granted = want ? await chrome.permissions.request(ALL_SITES) : !(await chrome.permissions.remove(ALL_SITES));
  $("framesPerm").checked = granted;
  if (granted === want) toast(t("savedShort"));
});

$("form").addEventListener("submit", (e) => e.preventDefault());

(async () => {
  localizePage();
  // The language's own name ("Deutsch") next to the UI-language name helps people find their language.
  const label = (code) => {
    const own = languageName(code, code);
    const local = languageName(code, ui);
    return own === local ? local : `${local} — ${own}`;
  };
  fillSelect($("targetLang"), TARGET_LOCALES, label);
  fillSelect($("nativeLang"), NATIVE_LANGS, label);
  for (const level of LEVELS) $("level").add(new Option(t(`level${level}`), level));

  const s = await getSettings();
  for (const id of SELECTS) $(id).value = s[id];
  $("quizMinutes").value = s.quizMinutes;
  $("apiKey").value = s.apiKey || "";
  document.querySelector(`input[name="trMode"][value="${s.trMode}"]`).checked = true;
  $("framesPerm").checked = await chrome.permissions.contains(ALL_SITES);
})();
