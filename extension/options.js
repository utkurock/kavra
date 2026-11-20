const { t, getSettings, baseLang, fillLanguageSelect, localizePage, TARGET_LOCALES, NATIVE_LANGS, LEVELS, PROVIDERS } =
  globalThis.Kavra;
const $ = (id) => document.getElementById(id);
const SELECTS = ["targetLang", "nativeLang", "level", "source", "textSize"];
let settings;

let toastTimer;
function toast(text, bad = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = text;
  $("toast").classList.toggle("bad", bad);
  $("toast").classList.add("show");
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1800);
}

// Settings save as soon as they change.
async function save(values) {
  await chrome.storage.local.set(values);
  settings = await getSettings();
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

$("lineHistory").addEventListener("change", () => save({ lineHistory: $("lineHistory").checked }));
$("lazyTranslate").addEventListener("change", () => save({ lazyTranslate: $("lazyTranslate").checked }));

$("quizMinutes").addEventListener("change", () => {
  const quizMinutes = Math.min(180, Math.max(3, Math.round(Number($("quizMinutes").value) || 20)));
  $("quizMinutes").value = quizMinutes;
  save({ quizMinutes });
});

// ---- AI provider: each provider keeps its own key and model ----
function showProvider() {
  const id = settings.provider;
  const provider = PROVIDERS[id];
  $("provider").value = id;
  $("apiKey").value = settings.apiKeys[id] || "";
  $("apiKey").placeholder = provider.keyHint;
  $("getKey").href = provider.keyUrl;
  $("model").value = settings.models[id] || "";
  $("model").placeholder = provider.model;
  $("modelHelp").textContent = t("modelHelp", provider.model);
  $("modelList").replaceChildren();
  $("modelStatus").textContent = "";
}

$("provider").addEventListener("change", async () => {
  await save({ provider: $("provider").value });
  showProvider();
});

$("apiKey").addEventListener("change", async () => {
  await chrome.storage.local.remove("apiKey"); // single key stored by versions before 0.6
  save({ apiKeys: { ...settings.apiKeys, [settings.provider]: $("apiKey").value.trim() } });
});

$("model").addEventListener("change", () => {
  const models = { ...settings.models };
  const model = $("model").value.trim();
  if (model) models[settings.provider] = model;
  else delete models[settings.provider];
  save({ models });
});

$("loadModels").addEventListener("click", async () => {
  $("loadModels").disabled = true;
  $("modelStatus").textContent = t("loadingModels");
  const res = await chrome.runtime.sendMessage({
    type: "listModels",
    provider: settings.provider,
    key: $("apiKey").value.trim(),
  });
  $("loadModels").disabled = false;
  if (!res?.ok) {
    $("modelStatus").textContent = res?.error || t("errUnreadable");
    return;
  }
  $("modelList").replaceChildren(...res.models.map((id) => new Option(id, id)));
  $("modelStatus").textContent = t("modelsLoaded", res.models.length);
  $("model").focus();
});

$("toggleKey").addEventListener("click", () => {
  const hidden = $("apiKey").type === "password";
  $("apiKey").type = hidden ? "text" : "password";
  $("toggleKey").textContent = hidden ? t("hide") : t("show");
});

$("form").addEventListener("submit", (e) => e.preventDefault());

(async () => {
  localizePage();
  fillLanguageSelect($("targetLang"), TARGET_LOCALES);
  fillLanguageSelect($("nativeLang"), NATIVE_LANGS);
  for (const level of LEVELS) $("level").add(new Option(t(`level${level}`), level));
  for (const [id, provider] of Object.entries(PROVIDERS)) $("provider").add(new Option(provider.name, id));

  settings = await getSettings();
  for (const id of SELECTS) $(id).value = settings[id];
  $("lineHistory").checked = settings.lineHistory;
  $("lazyTranslate").checked = settings.lazyTranslate;
  $("quizMinutes").value = settings.quizMinutes;
  document.querySelector(`input[name="trMode"][value="${settings.trMode}"]`).checked = true;
  showProvider();
})();
