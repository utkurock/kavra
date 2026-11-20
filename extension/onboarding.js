// First-run setup: languages and level, AI provider and key, how to use, translation mode.
// Every choice saves as soon as it's made, so closing the tab midway keeps what was picked.
const { t, getSettings, baseLang, fillLanguageSelect, localizePage, TARGET_LOCALES, NATIVE_LANGS, LEVELS, PROVIDERS } =
  globalThis.Kavra;
const $ = (id) => document.getElementById(id);
const steps = [...document.querySelectorAll(".step")];
const STEP_COUNT = 4; // the "done" screen isn't counted
let settings;
let current = 1;

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function showStep(n) {
  current = n;
  for (const step of steps) step.hidden = Number(step.dataset.step) !== n;
  const step = steps[n - 1];
  // Stagger order for the entrance animation: the step's blocks, then items inside lists and grids.
  [...step.children].forEach((child, i) => child.style.setProperty("--i", i));
  for (const list of step.querySelectorAll(".features, ol.howto, .grid")) {
    [...list.children].forEach((item, i) => item.style.setProperty("--i", i));
  }
  document.querySelectorAll(".steps span").forEach((bar, i) => bar.classList.toggle("filled", i < n));
  $("stepLabel").textContent = n <= STEP_COUNT ? t("obStepOf", n, STEP_COUNT) : "";
  step.querySelector("h1, h2").focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
  if (n === 1) demo.start();
  else demo.stop();
  if (n === 5) burst();
}

// ---- welcome demo: a fake player showing a line, its colour-matched translation, and a reveal ----
const DEMO_LINES = {
  tr: [
    ["I've been looking for you all day.", "Bütün gün seni arıyordum.", [["I've been looking for you", "seni arıyordum"], ["all day", "Bütün gün"]]],
    ["Don't give up on me now.", "Şimdi benden vazgeçme.", [["Don't give up on me", "benden vazgeçme"], ["now", "Şimdi"]]],
    ["We have to get out of here.", "Buradan çıkmamız gerek.", [["get out of here", "Buradan çıkmamız"], ["We have to", "gerek"]]],
  ],
  en: [
    ["Te he estado buscando todo el día.", "I've been looking for you all day.", [["Te he estado buscando", "I've been looking for you"], ["todo el día", "all day"]]],
    ["No te rindas conmigo ahora.", "Don't give up on me now.", [["No te rindas conmigo", "Don't give up on me"], ["ahora", "now"]]],
    ["Tenemos que salir de aquí.", "We have to get out of here.", [["Tenemos que", "We have to"], ["salir de aquí", "get out of here"]]],
  ],
};
const DEMO_COLORS = ["var(--hue-1)", "var(--hue-2)", "#ff9eb5"];

// Splits text into word chunks, colouring the ones inside a matched phrase.
function paintDemo(el, text, phrases) {
  el.replaceChildren();
  const marks = phrases
    .map((phrase, i) => ({ at: text.indexOf(phrase), end: text.indexOf(phrase) + phrase.length, color: DEMO_COLORS[i] }))
    .filter((m) => m.at >= 0);
  let order = 0;
  for (const match of text.matchAll(/\S+\s*/g)) {
    const span = document.createElement("span");
    span.className = "chunk";
    span.textContent = match[0];
    const mark = marks.find((m) => match.index >= m.at && match.index < m.end);
    if (mark) span.style.color = mark.color;
    span.style.setProperty("--d", `${order++ * 90}ms`);
    el.append(span);
  }
}

const demo = (() => {
  const lines = DEMO_LINES[chrome.i18n.getUILanguage().split("-")[0]] || DEMO_LINES.en;
  let timers = [];
  let index = 0;
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const cursor = () => $("demoCursor");

  function moveCursor(toTrans) {
    const box = document.querySelector(".demo").getBoundingClientRect();
    if (!toTrans) {
      cursor().style.opacity = "0";
      cursor().style.transform = `translate(${box.width * 0.82}px, ${box.height * 0.9}px)`;
      return;
    }
    const target = $("demoTrans").getBoundingClientRect();
    cursor().style.opacity = "1";
    cursor().style.transform = `translate(${target.left - box.left + target.width * 0.6}px, ${target.top - box.top + target.height * 0.4}px)`;
  }

  function play() {
    const [orig, trans, pairs] = lines[index++ % lines.length];
    paintDemo($("demoOrig"), orig, pairs.map((p) => p[0]));
    paintDemo($("demoTrans"), trans, pairs.map((p) => p[1]));
    $("demoSubs").classList.remove("out");
    $("demoTrans").className = "demo-line trans";
    requestAnimationFrame(() => $("demoOrig").classList.add("shown"));
    later(900, () => $("demoTrans").classList.add("shown"));
    later(1700, () => moveCursor(true));
    later(2500, () => $("demoTrans").classList.add("revealed"));
    later(4600, () => {
      moveCursor(false);
      $("demoSubs").classList.add("out");
    });
    later(5200, () => {
      $("demoOrig").classList.remove("shown");
      play();
    });
  }

  return {
    start() {
      this.stop();
      if (reducedMotion) {
        const [orig, trans, pairs] = lines[0];
        paintDemo($("demoOrig"), orig, pairs.map((p) => p[0]));
        paintDemo($("demoTrans"), trans, pairs.map((p) => p[1]));
        $("demoOrig").classList.add("shown");
        $("demoTrans").classList.add("shown", "revealed");
        return;
      }
      moveCursor(false);
      play();
    },
    stop() {
      timers.forEach(clearTimeout);
      timers = [];
    },
  };
})();

// ---- finish: a small burst of brand-coloured dots around the check mark ----
function burst() {
  const colors = ["#ffd54a", "#7fdbff", "#ff9eb5", "#ededf0"];
  $("burst").replaceChildren(
    ...Array.from({ length: 16 }, (_, i) => {
      const dot = document.createElement("i");
      dot.style.setProperty("--a", `${(360 / 16) * i + Math.random() * 10}deg`);
      dot.style.setProperty("--r", `${56 + Math.random() * 30}px`);
      dot.style.setProperty("--c", colors[i % colors.length]);
      return dot;
    })
  );
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
