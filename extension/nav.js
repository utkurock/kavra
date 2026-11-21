// App shell shared by the full-page views (activity, word pool, quiz, settings): a sidebar to move
// between them, with counts and a collapse button, and a top bar with the language pair and streak.
// On narrow windows the sidebar becomes a bar across the top.
(() => {
  const { t, getSettings, languageName, baseLang } = globalThis.Kavra;
  const { summarize } = globalThis.KavraCharts;
  const ui = chrome.i18n.getUILanguage();
  const svg = (paths, width = 1.8) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    words: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6"/>',
    quiz: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
    settings:
      '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    collapse: '<path d="m15 6-6 6 6 6"/>',
    streak: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1.2 2.6 2.4 3C11 9 11 6 12 3z"/>',
    languages: '<path d="M4 5h8M8 3v2M10.5 5c-.8 3.6-3 6.4-6 8M6 9c1.2 1.8 2.8 3.2 4.5 4"/><path d="m13 21 4-9 4 9M14.5 18h5"/>',
  };
  const PAGES = [
    ["activity.html", "tabActivity", "activity"],
    ["words.html", "navWords", "words"],
    ["quiz.html", "navQuiz", "quiz"],
    ["options.html", "settings", "settings"],
  ];
  const current = location.pathname.split("/").pop();
  const make = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const icon = (name) => {
    const span = document.createElement("span");
    span.innerHTML = svg(ICONS[name]);
    return span.firstChild;
  };

  // ---- sidebar ----
  const counts = {};
  const links = PAGES.map(([href, key, name]) => {
    counts[name] = make("span", { className: "count" });
    const link = make("a", { className: "sidenav-link", href, title: t(key) }, [
      icon(name),
      make("span", { className: "label", textContent: t(key) }),
      counts[name],
    ]);
    if (href === current) link.setAttribute("aria-current", "page");
    return link;
  });
  const collapse = make("button", { className: "icon-btn collapse", type: "button" }, [icon("collapse")]);
  const version = chrome.runtime.getManifest().version;
  const sidebar = make("aside", { className: "sidebar dotted" }, [
    make("div", { className: "sidebar-head" }, [
      make("a", { className: "brand", href: "activity.html" }, [
        make("img", { src: "icons/logo.svg", alt: "" }),
        make("span", { className: "label", textContent: t("extName") }),
      ]),
    ]),
    make("nav", { className: "sidenav", ariaLabel: t("navLabel") }, links),
    make("div", { className: "sidebar-foot" }, [
      make("span", { className: "label", textContent: `v${version}` }),
      make("a", { className: "label", href: "https://github.com/utkurock/kavra", target: "_blank", rel: "noopener", textContent: "GitHub ↗" }),
      collapse,
    ]),
  ]);

  // A narrow sidebar with icons only, remembered per browser.
  const COLLAPSED = "kavra.sidebarCollapsed";
  function setCollapsed(on) {
    document.body.classList.toggle("collapsed", on);
    collapse.ariaLabel = collapse.title = t(on ? "expandSidebar" : "collapseSidebar");
    collapse.ariaExpanded = String(!on);
    try {
      localStorage.setItem(COLLAPSED, on ? "1" : "");
    } catch {
      // storage unavailable: it just won't be remembered
    }
  }
  collapse.addEventListener("click", () => setCollapsed(!document.body.classList.contains("collapsed")));
  let startCollapsed = false;
  try {
    startCollapsed = localStorage.getItem(COLLAPSED) === "1";
  } catch {
    // storage unavailable
  }

  // ---- top bar: what you're learning and your streak ----
  const pair = make("span", { className: "chip" }, [icon("languages"), make("span")]);
  const streak = make("span", { className: "chip streak" }, [icon("streak"), make("span")]);
  const appbar = make("header", { className: "appbar" }, [make("div", { className: "appbar-end" }, [pair, streak])]);

  document.body.classList.add("app");
  setCollapsed(startCollapsed);
  document.body.prepend(sidebar, appbar);

  // ---- live figures ----
  async function refresh() {
    const [settings, { words = [], quizzes = [], activity = {} }] = await Promise.all([
      getSettings(),
      chrome.storage.local.get(["words", "quizzes", "activity"]),
    ]);
    const lang = baseLang(settings.targetLang);
    const saved = words.filter((w) => baseLang(w.lang) === lang).length;
    // Quizzes with questions left to answer.
    const open = quizzes.filter((q) => (q.answers || []).filter((a) => a != null).length < q.questions.length).length;
    counts.words.textContent = saved || "";
    counts.quiz.textContent = open > 0 ? open : "";
    pair.lastChild.textContent = `${languageName(lang, ui)} → ${languageName(settings.nativeLang, ui)}`;
    const days = summarize(activity).streak;
    streak.lastChild.textContent = t("streakDays", days);
    streak.classList.toggle("lit", days > 0);
  }
  refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && ["words", "quizzes", "activity", "targetLang", "nativeLang"].some((k) => k in changes)) refresh();
  });
})();
