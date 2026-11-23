// Small building blocks shared by the views: elements, icons, level badges and chips, a toast, speech.
import { LEVELS, state, save } from "./store.js";
import { LANGS, uiLang, t } from "./i18n.js";

export const $ = (id) => document.getElementById(id);
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
export function button(className, text, onClick) {
  const b = el("button", className, text);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

const PATHS = {
  cards: '<rect x="3" y="7" width="13" height="14" rx="2.5"/><path d="M8 3h10.5A2.5 2.5 0 0 1 21 5.5V17"/>',
  blocks: '<rect x="3" y="4" width="8" height="7" rx="2"/><rect x="13" y="4" width="8" height="7" rx="2"/><rect x="3" y="13" width="12" height="7" rx="2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  speaker: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  question: '<path d="M9.2 9a3 3 0 1 1 4.3 2.7c-.9.5-1.5 1.2-1.5 2.3"/><path d="M12 18h.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
};
export function icon(name, width = 2) {
  const span = document.createElement("span");
  span.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return span.firstChild;
}

export const levelClass = (level) => `lv-${level[0].toLowerCase()}`;
export const badge = (level) => el("span", `badge ${levelClass(level)}`, level);

// Which levels are on, in short: "A1–B1", "A1, B2", or all of them.
function levelSummary() {
  const on = state.levels;
  if (on.length === LEVELS.length) return t("allLevels");
  if (!on.length) return t("noLevels");
  const at = on.map((l) => LEVELS.indexOf(l));
  const contiguous = at.every((x, i) => !i || x === at[i - 1] + 1);
  return contiguous && on.length > 1 ? `${on[0]}–${on.at(-1)}` : on.join(", ");
}

// The level filter, saved and shared by every view: a row of toggles on wide screens; on phones one
// button with the levels in short, which opens the toggles.
export function levelChips(onChange, available = LEVELS) {
  const wrap = el("div", "levels");
  const toggle = button("level-toggle", null, () => {
    wrap.classList.toggle("open");
    toggle.ariaExpanded = String(wrap.classList.contains("open"));
  });
  toggle.ariaExpanded = "false";
  const label = el("span");
  toggle.append(icon("sliders"), label, icon("chevron"));
  const row = el("div", "chips");
  row.role = "group";
  row.ariaLabel = t("levels");
  for (const level of LEVELS) {
    const chip = button(`chip ${levelClass(level)}`, level, () => {
      const set = new Set(state.levels);
      if (set.has(level)) set.delete(level);
      else set.add(level);
      state.levels = LEVELS.filter((l) => set.has(l));
      save();
      paint();
      onChange();
    });
    chip.dataset.level = level;
    chip.disabled = !available.includes(level);
    row.append(chip);
  }
  const paint = () => {
    for (const chip of row.children) chip.ariaPressed = String(state.levels.includes(chip.dataset.level));
    label.textContent = levelSummary();
  };
  paint();
  // A tap anywhere else closes the open toggles.
  const close = (e) => {
    if (!wrap.isConnected) return document.removeEventListener("pointerdown", close);
    if (!wrap.contains(e.target)) {
      wrap.classList.remove("open");
      toggle.ariaExpanded = "false";
    }
  };
  document.addEventListener("pointerdown", close);
  wrap.append(toggle, row);
  return wrap;
}

let toastTimer;
export function toast(text) {
  const box = $("toast");
  box.textContent = text;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 2600);
}

// Reads text aloud in the language being learned ("(f)" style gender notes are left out).
export function speak(text, lang = state.target) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/\s*\([mf]\)\s*$/, ""));
  utterance.lang = LANGS[lang]?.voice || lang;
  speechSynthesis.speak(utterance);
}

// Numbers the way the interface language writes them (5.000 in Turkish, 5,000 in English).
export const fmt = (n) => n.toLocaleString(uiLang());
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
