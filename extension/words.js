// Word pool: the lines saved from the translation card, with search, removal and undo.
const { t, localizePage, languageName, baseLang } = globalThis.Kavra;
const $ = (id) => document.getElementById(id);
const ui = chrome.i18n.getUILanguage();
let words = [];

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';

function item(word, showLang) {
  const li = el("li", "card word");
  li.append(el("div", "w-orig", word.text), el("div", "w-trans", word.translation));
  if (word.notes?.length) {
    const ul = el("ul");
    for (const note of word.notes) {
      const row = el("li");
      row.append(el("b", null, note.phrase), ` — ${note.meaning}`);
      ul.append(row);
    }
    li.append(ul);
  }
  const meta = el("div", "w-meta");
  meta.append(el("span", null, new Date(word.savedAt).toLocaleDateString(ui, { day: "numeric", month: "short", year: "numeric" })));
  if (showLang) meta.append(el("span", null, languageName(baseLang(word.lang), ui)));
  if (word.url) {
    const link = el("a", null, new URL(word.url).hostname.replace(/^www\./, ""));
    Object.assign(link, { href: word.url, target: "_blank", rel: "noopener" });
    meta.append(link);
  }
  li.append(meta);
  const remove = el("button", "remove");
  remove.innerHTML = TRASH;
  remove.ariaLabel = remove.title = t("removeWord");
  remove.addEventListener("click", () => removeWord(word, li));
  li.append(remove);
  return li;
}

function render() {
  const query = $("search").value.trim().toLocaleLowerCase(ui);
  const shown = query
    ? words.filter((w) => [w.text, w.translation, ...(w.notes || []).map((n) => n.phrase)].join(" ").toLocaleLowerCase(ui).includes(query))
    : words;
  const showLang = new Set(words.map((w) => baseLang(w.lang))).size > 1;
  $("list").replaceChildren(...shown.map((w) => item(w, showLang)));
  $("count").textContent = words.length ? t("wordsCount", words.length) : "";
  $("empty").hidden = shown.length > 0;
  $("empty").textContent = words.length ? t("wordsNoMatch") : t("wordsEmpty");
}

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
  if (area !== "local" || !changes.words) return;
  words = changes.words.newValue || [];
  render();
});

(async () => {
  localizePage();
  words = (await chrome.storage.local.get("words")).words || [];
  render();
})();
