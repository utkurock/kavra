// First-run setup: languages and level, AI provider and key, how to use, translation mode.
// Every choice saves as soon as it's made, so closing the tab midway keeps what was picked.
const { t, getSettings, baseLang, fillLanguageSelect, localizePage, TARGET_LOCALES, NATIVE_LANGS, LEVELS, PROVIDERS } =
  globalThis.Kavra;
const $ = (id) => document.getElementById(id);
const steps = [...document.querySelectorAll(".step")];
const STEP_COUNT = 4; // the "done" screen isn't counted
let settings;
let current = 1;

function showStep(n) {
  current = n;
  for (const step of steps) step.hidden = Number(step.dataset.step) !== n;
  document.querySelectorAll(".steps span").forEach((bar, i) => bar.classList.toggle("filled", i < n));
  $("stepLabel").textContent = n <= STEP_COUNT ? t("obStepOf", n, STEP_COUNT) : "";
  steps[n - 1].querySelector("h1, h2").focus();
  window.scrollTo({ top: 0 });
}

async function save(values) {
  await chrome.storage.local.set(values);
  settings = await getSettings();
}

function choice(name, value, title, detail, checked) {
  const label = document.createElement("label");
  label.className = "choice";
  const input = Object.assign(document.createElement("input"), { type: "radio", name, value, checked });
  const strong = Object.assign(document.createElement("strong"), { textContent: title });
  label.append(input, strong);
  if (detail) label.append(detail);
  return label;
}

// ---- step 2: languages and level ----
function languagesValid() {
  const same = baseLang($("targetLang").value) === $("nativeLang").value;
  $("langError").hidden = !same;
  $("langNext").disabled = same;
  return !same;
}
for (const id of ["targetLang", "nativeLang"]) {
  $(id).addEventListener("change", () => languagesValid() && save({ [id]: $(id).value }));
}

// ---- step 3: AI provider and key ----
function showProvider() {
  const provider = PROVIDERS[settings.provider];
  $("apiKey").value = settings.apiKeys[settings.provider] || "";
  $("apiKey").placeholder = provider.keyHint;
  $("getKey").href = provider.keyUrl;
  $("keyStatus").textContent = "";
  $("keyStatus").className = "key-status";
}
async function saveKey() {
  await chrome.storage.local.remove("apiKey"); // single key stored by versions before 0.6
  await save({ apiKeys: { ...settings.apiKeys, [settings.provider]: $("apiKey").value.trim() } });
}
$("apiKey").addEventListener("change", saveKey);
$("toggleKey").addEventListener("click", () => {
  const hidden = $("apiKey").type === "password";
  $("apiKey").type = hidden ? "text" : "password";
  $("toggleKey").textContent = hidden ? t("hide") : t("show");
});
// Listing models checks the key without spending tokens.
$("verifyKey").addEventListener("click", async () => {
  await saveKey();
  $("verifyKey").disabled = true;
  $("keyStatus").className = "key-status";
  $("keyStatus").textContent = t("obVerifying");
  const res = await chrome.runtime.sendMessage({ type: "listModels", provider: settings.provider, key: settings.key });
  $("verifyKey").disabled = false;
  $("keyStatus").className = `key-status ${res?.ok ? "ok" : "bad"}`;
  $("keyStatus").textContent = res?.ok ? t("obKeyOk") : res?.error || t("errUnreadable");
});
$("aiNext").addEventListener("click", saveKey);

// ---- navigation ----
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-next]")) showStep(current + 1);
  else if (e.target.closest("[data-back]")) showStep(current - 1);
});
$("finish").addEventListener("click", async () => {
  await save({ onboarded: true });
  showStep(5);
});
$("close").addEventListener("click", () => window.close());

(async () => {
  localizePage();
  settings = await getSettings();

  fillLanguageSelect($("targetLang"), TARGET_LOCALES);
  fillLanguageSelect($("nativeLang"), NATIVE_LANGS);
  $("targetLang").value = settings.targetLang;
  $("nativeLang").value = settings.nativeLang;
  languagesValid();

  for (const level of LEVELS) {
    const [, name] = t(`level${level}`).split(" · ");
    const card = choice("level", level, level, Object.assign(document.createElement("span"), { textContent: name }), settings.level === level);
    $("levels").append(card);
  }
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    const model = document.createElement("code");
    model.textContent = provider.model;
    const detail = document.createElement("span");
    detail.append(model);
    $("providers").append(choice("provider", id, provider.name, detail, settings.provider === id));
  }
  document.querySelector(`input[name="trMode"][value="${settings.trMode}"]`).checked = true;

  document.addEventListener("change", async (e) => {
    const { name, value } = e.target;
    if (name === "level" || name === "trMode") save({ [name]: value });
    if (name === "provider") {
      await save({ provider: value });
      showProvider();
    }
  });

  showProvider();
  showStep(1);
})();
