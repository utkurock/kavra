// First visit (and "change language"): native language, the language to learn, then a starting level.
import { state, save, LEVELS } from "./store.js";
import { t, setUiLang, LANGS, NATIVES, targetsFor, langName } from "./i18n.js";
import * as data from "./data.js";
import { $, el, button, icon, fmt } from "./ui.js";

// Starting levels to choose from, as ranges of the level filter.
const STARTS = [
  ["levelStart", ["A1", "A2"]],
  ["levelSome", ["A2", "B1"]],
  ["levelMid", ["B1", "B2"]],
  ["levelHigh", ["B2", "C1", "C2"]],
  ["levelAll", LEVELS],
];

export async function onboard(onDone) {
  const box = $("onboarding");
  box.hidden = false;
  document.body.classList.add("onboarding-open");
  const choice = { native: state.native, target: state.target, levels: state.levels };
  let index = {};
  try {
    index = await data.catalog();
  } catch {
    // shown without counts; the language list itself is fixed
  }
  let step = 0;

  const steps = [
    {
      title: () => t("obNativeTitle"),
      sub: () => t("obNativeSub"),
      body: () =>
        Object.entries(NATIVES).map(([code, name]) =>
          option(name, null, choice.native === code, () => {
            choice.native = code;
            setUiLang(code);
            if (choice.target === code) choice.target = targetsFor(code)[0];
            go(1);
          })
        ),
    },
    {
      title: () => t("obTargetTitle"),
      sub: () => t("obTargetSub"),
      body: () =>
        targetsFor(choice.native).map((code) => {
          const info = index[code];
          const ready = Boolean(info?.words) && (code !== "en" || choice.native === "tr");
          const meta = ready
            ? [t("wordsCount", fmt(info.words)), info.units ? t("unitsCount", info.units) : null].filter(Boolean).join(" · ")
            : t("soon");
          const own = LANGS[code].own;
          const name = langName(code);
          const opt = option(own === name ? own : `${name} · ${own}`, meta, choice.target === code, () => {
            choice.target = code;
            go(2);
          });
          opt.prepend(el("span", "lang-code", code.toUpperCase()));
          opt.disabled = !ready;
          return opt;
        }),
    },
    {
      title: () => t("obLevelTitle"),
      sub: () => t("obLevelSub"),
      body: () =>
        STARTS.map(([key, levels]) =>
          option(t(key), levels.length === LEVELS.length ? "A1–C2" : `${levels[0]}–${levels.at(-1)}`, String(choice.levels) === String(levels), () => {
            choice.levels = levels;
            finish();
          })
        ),
    },
  ];

  function option(label, meta, selected, onPick) {
    const b = button("ob-option", null, onPick);
    const text = el("span", "ob-text");
    text.append(el("span", "ob-label", label));
    if (meta) text.append(el("span", "ob-meta", meta));
    b.append(text, icon("chevron"));
    b.ariaPressed = String(selected);
    return b;
  }

  function go(to) {
    step = to;
    const s = steps[step];
    const top = el("div", "ob-top");
    const back = button("round-btn", null, () => go(step - 1));
    back.append(icon("back"));
    back.ariaLabel = t("back");
    back.style.visibility = step ? "visible" : "hidden";
    const dots = el("div", "ob-dots");
    steps.forEach((_, i) => dots.append(el("span", i <= step ? "on" : "")));
    top.append(back, dots, el("span", "ob-spacer"));
    const panel = el("div", "ob-panel");
    if (step === 0) {
      const brand = el("div", "ob-brand");
      const logo = el("img");
      Object.assign(logo, { src: "icon.svg", alt: "" });
      brand.append(logo, el("span", null, t("obWelcome")));
      panel.append(brand);
    }
    panel.append(el("h1", null, s.title()), el("p", "ob-sub", s.sub()));
    const list = el("div", "ob-list");
    list.append(...s.body());
    panel.append(list);
    box.replaceChildren(top, panel);
    panel.querySelector("[aria-pressed='true']:not(:disabled)")?.focus({ preventScroll: true });
  }

  function finish() {
    Object.assign(state, { ...choice, onboarded: true });
    save();
    box.hidden = true;
    box.replaceChildren();
    document.body.classList.remove("onboarding-open");
    onDone();
  }

  go(0);
}
