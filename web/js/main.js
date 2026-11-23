// Boots the app: onboarding on the first visit (the languages change later in Settings), then the
// shell — a sidebar on wide screens, a tab bar at the bottom on phones — with four views chosen by the
// address hash.
import { state, save, progress } from "./store.js";
import { t, setUiLang, langName, NATIVES } from "./i18n.js";
import { $, el, button, icon, toast } from "./ui.js";
import { onboard } from "./onboarding.js";
import { showStudy, showLists, studyKey } from "./words.js";
import { showSentences, sentenceKey } from "./sentences.js";

const ROUTES = {
  words: { label: "navWords", icon: "cards", show: showStudy },
  sentences: { label: "navSentences", icon: "blocks", show: showSentences },
  lists: { label: "navLists", icon: "list", show: showLists },
  settings: { label: "navSettings", icon: "gear", show: showSettings },
};
const route = () => (location.hash.slice(1) in ROUTES ? location.hash.slice(1) : "words");

function applyTheme() {
  document.documentElement.dataset.theme = state.theme === "system" ? "" : state.theme;
}

// ---- the shell ----
function buildShell() {
  document.title = t("appName");
  const nav = $("nav");
  nav.replaceChildren(
    ...Object.entries(ROUTES).map(([name, r]) => {
      const a = el("a", "nav-link");
      a.href = `#${name}`;
      a.dataset.route = name;
      a.append(icon(r.icon), el("span", null, t(r.label)));
      return a;
    })
  );
  for (const node of document.querySelectorAll("[data-app-name]")) node.textContent = t("appName");
  $("app").hidden = false;
}

function show() {
  const name = route();
  for (const link of document.querySelectorAll(".nav-link")) link.ariaCurrent = link.dataset.route === name ? "page" : null;
  const view = $("view");
  view.dataset.view = name;
  ROUTES[name].show(view);
  view.focus({ preventScroll: true });
  scrollTo(0, 0);
}

function changeLanguage() {
  onboard(() => {
    setUiLang(state.native);
    buildShell();
    show();
  });
}

// ---- settings ----
function showSettings(container) {
  const head = el("div", "view-head");
  head.append(el("h1", null, t("navSettings")));

  const lang = el("section", "panel setting");
  const langText = el("div");
  langText.append(el("h2", null, t("settingsLang")), el("p", "muted", `${NATIVES[state.native]} → ${langName(state.target)}`));
  lang.append(langText, button("btn", t("change"), changeLanguage));

  const theme = el("section", "panel setting");
  const seg = el("div", "seg");
  for (const value of ["system", "light", "dark"]) {
    const b = button("seg-btn", t(`theme${value[0].toUpperCase()}${value.slice(1)}`), () => {
      state.theme = value;
      save();
      applyTheme();
      for (const x of seg.children) x.ariaPressed = String(x === b);
    });
    b.ariaPressed = String(state.theme === value);
    seg.append(b);
  }
  theme.append(el("h2", null, t("theme")), seg);

  const reset = el("section", "panel setting");
  const resetText = el("div");
  resetText.append(el("h2", null, t("resetTitle")), el("p", "muted", t("resetText", langName(state.target))));
  reset.append(
    resetText,
    button("btn danger", t("resetButton"), () => {
      if (!confirm(t("resetConfirm", langName(state.target)))) return;
      const p = progress();
      p.deck = {};
      p.lessons = {};
      save();
      toast(t("resetDone"));
    })
  );

  const about = el("section", "panel");
  about.append(el("h2", null, t("about")), el("p", "muted", t("aboutText")));

  const stack = el("div", "settings");
  stack.append(lang, theme, reset, about);
  container.replaceChildren(head, stack);
}

// ---- keys for the open view ----
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || document.body.classList.contains("onboarding-open")) return;
  if (e.target.closest?.("input, textarea, select")) return;
  const handled = route() === "words" ? studyKey(e) : route() === "sentences" && sentenceKey(e);
  if (handled) e.preventDefault();
});

// ---- start ----
setUiLang(state.native);
applyTheme();
addEventListener("hashchange", show);
if (state.onboarded) {
  buildShell();
  show();
} else {
  onboard(() => {
    setUiLang(state.native);
    buildShell();
    show();
  });
}
