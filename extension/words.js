// Word pool: the lines saved from the translation card, with search, removal and undo.
const { t, localizePage, languageName, baseLang, getSettings } = globalThis.Kavra;
const QUIZ_MIN = 4; // matches the background's minimum
const $ = (id) => document.getElementById(id);
const ui = chrome.i18n.getUILanguage();
let words = [];
let targetLang = "";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const svg = (paths) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  `stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const TRASH = svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>');
const PLAY = svg('<path d="M7 5v14l11-7z"/>');

// Each source site keeps one colour from the palette.
const SITE_COLOURS = ["var(--hue-2)", "var(--hue-1)", "#ff9eb5", "var(--ok)"];
function siteColour(host) {
  let hash = 0;
  for (const ch of host) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return SITE_COLOURS[hash % SITE_COLOURS.length];
}
const SITE_NAMES = { "youtube.com": "YouTube", "netflix.com": "Netflix" };

// "3 days ago", "yesterday", in the browser's language.
const relative = new Intl.RelativeTimeFormat(ui, { numeric: "auto" });
function ago(time) {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86400000);
  if (days < 7) return relative.format(-days, "day");
  if (days < 60) return relative.format(-Math.round(days / 7), "week");
  return new Date(time).toLocaleDateString(ui, { day: "numeric", month: "short", year: "numeric" });
}

// A saved line as a card: its source and age on top, the line and translation, notes, then actions.
function item(word, showLang) {
  const li = el("li", "card wcard");
  const top = el("div", "wcard-top");
  let host = "";
  try {
    host = new URL(word.url).hostname.replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    // saved without a page address
  }
  if (host) {
    const badge = el("span", "badge");
    badge.innerHTML = PLAY;
    badge.append(SITE_NAMES[host] || host);
    badge.style.setProperty("--c", siteColour(host));
    top.append(badge);
  }
  top.append(el("span", "when", ago(word.savedAt)));
  li.append(top, el("div", "w-orig", word.text), el("div", "w-trans", word.translation));
  if (word.notes?.length) {
    const ul = el("ul", "w-notes");
    for (const note of word.notes) {
      const row = el("li");
      row.append(el("b", null, note.phrase), ` — ${note.meaning}`);
      ul.append(row);
    }
    li.append(ul);
  }
  const foot = el("div", "wcard-foot");
  const facts = [];
  if (word.notes?.length) facts.push(word.notes.length === 1 ? t("noteCountOne") : t("noteCount", word.notes.length));
  if (showLang) facts.push(languageName(baseLang(word.lang), ui));
  foot.append(el("span", "facts", facts.join(" · ")));
  const actions = el("span", "actions");
  if (word.url) {
    const link = el("a", "tag", `${t("openVideo")} ↗`);
    Object.assign(link, { href: word.url, target: "_blank", rel: "noopener" });
    actions.append(link);
  }
  const remove = el("button", "remove");
  remove.innerHTML = TRASH;
  remove.ariaLabel = remove.title = t("removeWord");
  remove.addEventListener("click", () => removeWord(word, li));
  actions.append(remove);
  foot.append(actions);
  li.append(foot);
  return li;
}

// ---- tabs: all lines, or only those with notes ----
let tab = "all";
const withNotes = (w) => w.notes?.length > 0;
for (const button of document.querySelectorAll(".segtab")) {
  button.addEventListener("click", () => {
    tab = button.dataset.tab;
    render();
  });
}

function render() {
  const query = $("search").value.trim().toLocaleLowerCase(ui);
  const inTab = tab === "notes" ? words.filter(withNotes) : words;
  const shown = query
    ? inTab.filter((w) => [w.text, w.translation, ...(w.notes || []).map((n) => n.phrase)].join(" ").toLocaleLowerCase(ui).includes(query))
    : inTab;
  const showLang = new Set(words.map((w) => baseLang(w.lang))).size > 1;
  $("list").replaceChildren(...shown.map((w) => item(w, showLang)));
  for (const button of document.querySelectorAll(".segtab")) {
    button.ariaSelected = String(button.dataset.tab === tab);
    button.querySelector(".count").textContent = button.dataset.tab === "notes" ? words.filter(withNotes).length : words.length;
  }
  $("empty").hidden = shown.length > 0;
  $("emptyText").textContent = words.length ? t("wordsNoMatch") : t("wordsEmpty");
  // A quiz uses the lines of the language being learned.
  const usable = words.filter((w) => baseLang(w.lang) === baseLang(targetLang)).length;
  $("quiz").disabled = quizBusy || usable < QUIZ_MIN;
  $("quiz").title = usable < QUIZ_MIN ? t("wordQuizNotEnough", QUIZ_MIN) : "";
}

// ---- quiz from the word pool ----
let quizBusy = false;
function quizStatus(text, bad = false) {
  $("quizStatus").textContent = text;
  $("quizStatus").classList.toggle("bad", bad);
  $("quizStatus").hidden = !text;
}
$("quiz").addEventListener("click", async () => {
  quizBusy = true;
  render();
  quizStatus(t("quizPreparing"));
  const res = await chrome.runtime.sendMessage({ type: "wordQuiz" }).catch(() => null);
  quizBusy = false;
  render();
  quizStatus(res?.ok ? "" : res?.error || t("quizFailed"), !res?.ok);
});

// Removing takes effect at once; the toast offers to put it back where it was.
let toastTimer;
async function removeWord(word, li) {
  li.classList.add("leaving");
  await new Promise((r) => setTimeout(r, 180));
  await chrome.runtime.sendMessage({ type: "toggleWord", word });
  const undo = el("button", null, t("undo"));
  undo.addEventListener("click", async () => {
    $("toast").classList.remove("show");
    await chrome.runtime.sendMessage({ type: "toggleWord", word });
  });
  $("toast").replaceChildren(t("wordRemoved"), undo);
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 5000);
}

$("search").addEventListener("input", render);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(changes.words || changes.targetLang)) return;
  if (changes.words) words = changes.words.newValue || [];
  if (changes.targetLang) targetLang = changes.targetLang.newValue;
  render();
});

(async () => {
  localizePage();
  words = (await chrome.storage.local.get("words")).words || [];
  targetLang = (await getSettings()).targetLang;
  render();
})();
