// Sidebar shared by the full-page views (activity, word pool, quiz, settings) so you can move
// between them; on narrow windows it becomes a bar across the top.
(() => {
  const { t } = globalThis.Kavra;
  const ICONS = {
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    words: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6"/>',
    quiz: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
    settings:
      '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
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
  const icon = (paths) => {
    const span = document.createElement("span");
    span.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
      `stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    return span.firstChild;
  };

  const version = chrome.runtime.getManifest().version;
  const brand = make("a", { className: "brand", href: "activity.html" }, [
    make("img", { src: "icons/logo.svg", alt: "" }),
    make("span", { textContent: t("extName") }),
  ]);
  const links = PAGES.map(([href, key, name]) => {
    const link = make("a", { className: "sidenav-link", href }, [icon(ICONS[name]), make("span", { textContent: t(key) })]);
    link.title = t(key);
    if (href === current) link.setAttribute("aria-current", "page");
    return link;
  });
  const nav = make("nav", { className: "sidenav", ariaLabel: t("navLabel") }, links);
  const foot = make("div", { className: "sidebar-foot" }, [
    make("span", { textContent: `v${version}` }),
    make("a", { href: "https://github.com/utkurock/kavra", target: "_blank", rel: "noopener", textContent: "GitHub ↗" }),
  ]);
  document.body.classList.add("app");
  document.body.prepend(make("aside", { className: "sidebar dotted" }, [brand, nav, foot]));
})();
