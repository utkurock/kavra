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

const TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';

function item(word, showLang) {
  const li = el("li", "word");
  const body = el("div", "w-body");
  body.append(el("div", "w-orig", word.text), el("div", "w-trans", word.translation));
  if (word.notes?.length) {
    const ul = el("ul");
    for (const note of word.notes) {
      const row = el("li");
      row.append(el("b", null, note.phrase), ` — ${note.meaning}`);
      ul.append(row);
    }
    body.append(ul);
  }
  const meta = el("div", "w-meta");
  meta.append(el("span", null, new Date(word.savedAt).toLocaleDateString(ui, { day: "numeric", month: "short", year: "numeric" })));
  if (showLang) meta.append(el("span", null, languageName(baseLang(word.lang), ui)));
  if (word.url) {
    const link = el("a", null, new URL(word.url).hostname.replace(/^www\./, ""));
    Object.assign(link, { href: word.url, target: "_blank", rel: "noopener" });
    meta.append(link);
  }
  const remove = el("button", "remove");
  remove.innerHTML = TRASH;
  remove.ariaLabel = remove.title = t("removeWord");
  remove.addEventListener("click", () => removeWord(word, li));
  const side = el("div", "w-side");
  side.append(meta, remove);
  li.append(body, side);
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
