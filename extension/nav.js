// Top bar shared by the full-page views (activity, word pool, quiz, settings) so you can move between them.
(() => {
  const { t } = globalThis.Kavra;
  const PAGES = [
    ["activity.html", "tabActivity"],
    ["words.html", "navWords"],
    ["quiz.html", "navQuiz"],
    ["options.html", "settings"],
  ];
  const current = location.pathname.split("/").pop();
  const make = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  const brand = make("a", { className: "brand", href: "activity.html" }, [
    make("img", { src: "icons/logo.svg", alt: "" }),
    make("span", { textContent: t("extName") }),
    make("span", { className: "version", textContent: chrome.runtime.getManifest().version }),
  ]);
  const links = PAGES.map(([href, key]) => {
    const link = make("a", { className: "topnav-link", href, textContent: t(key) });
    if (href === current) link.setAttribute("aria-current", "page");
    return link;
  });
  const nav = make("nav", { className: "topnav", ariaLabel: t("navLabel") }, links);
  const github = make("a", {
    className: "topbar-gh small",
    href: "https://github.com/utkurock/kavra",
    target: "_blank",
    rel: "noopener",
    textContent: "GitHub ↗",
  });
  const bar = make("header", { className: "topbar dotted" }, [make("div", { className: "topbar-inner" }, [brand, nav, github])]);
  document.body.prepend(bar);
})();
