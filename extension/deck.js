// Core words: the 5000 most frequent English words as a pile of cards. Swipe right (or →) for a word
// you know, left (←) for one you don't, up (↑) when you're not sure. The ones you don't know or aren't
// sure of are kept in lists and come back in Review. Meanings are written by the AI provider, a batch
// at a time ahead of the pile, and kept.
const { t, localizePage, getSettings, baseLang, languageName } = globalThis.Kavra;
const $ = (id) => document.getElementById(id);
const STATES = ["known", "unsure", "unknown"];
const PILE = 3; // cards drawn: the top one and two behind it
const AHEAD = 6; // ask for meanings once fewer than this many upcoming cards have one
const BATCH = 20; // words explained per request
const THRESHOLD = 110; // pixels of drag that count as a swipe

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

let words = []; // the deck, most frequent first
const rank = new Map(); // word -> 1-based place in the deck
let deck = {}; // word -> { s, at }
let glosses = {}; // word -> { pos, meaning, example, example_translation } in the user's language
let nativeLang = "";
let hasKey = false;
let mode = "new";
let review = []; // the words of the current review round
let reviewAt = 0;
const history = []; // swipes that can be undone: { word, prev, mode }

// ---- what comes next ----
function upcoming(count) {
  if (mode === "review") return review.slice(reviewAt, reviewAt + count);
  const next = [];
  for (const word of words) {
    if (!deck[word]) next.push(word);
    if (next.length === count) break;
  }
  return next;
}

// A review round: words you don't know first, then the ones you weren't sure of, most frequent first.
function startReview() {
  const order = { unknown: 0, unsure: 1 };
  review = words.filter((w) => deck[w]?.s in order).sort((a, b) => order[deck[a].s] - order[deck[b].s] || rank.get(a) - rank.get(b));
  reviewAt = 0;
}

// ---- meanings, fetched ahead of the pile ----
const asked = new Set();
let glossError = "";
async function fetchGlosses() {
  if (!hasKey) return;
  const ahead = upcoming(AHEAD + BATCH);
  if (ahead.slice(0, AHEAD).every((w) => glosses[w] || asked.has(w))) return;
  const batch = ahead.filter((w) => !glosses[w] && !asked.has(w)).slice(0, BATCH);
  batch.forEach((w) => asked.add(w));
  glossError = "";
  const res = await chrome.runtime.sendMessage({ type: "deckGloss", words: batch }).catch(() => null);
  if (res?.ok) Object.assign(glosses, res.glosses);
  else {
    glossError = res?.error || t("quizFailed");
    batch.forEach((w) => asked.delete(w)); // asked for again on retry
  }
  for (const card of $("pile").querySelectorAll(".fcard")) fillReveal(card);
  renderLists();
}

function fillReveal(card) {
  const word = card.dataset.word;
  const gloss = glosses[word];
  card.querySelector(".fpos").textContent = gloss?.pos || "";
  const body = card.querySelector(".freveal .body");
  // Only a meaning is hidden until the card is turned over; notes about it show at once.
  card.querySelector(".freveal").classList.toggle("ready", Boolean(gloss));
  if (gloss) {
    const example = el("p", "example", gloss.example);
    example.lang = "en";
    example.append(el("i", null, gloss.example_translation));
    body.replaceChildren(el("p", "meaning", gloss.meaning), example);
    body.querySelector(".meaning").lang = nativeLang;
    return;
  }
  if (!hasKey) {
    const note = el("p", "note", t("deckNoKey"));
    const link = el("a", null, t("settings"));
    link.href = "options.html";
    note.append(" ", link);
    body.replaceChildren(note);
  } else if (glossError && !asked.has(word)) {
    const note = el("p", "note bad", t("deckGlossFailed", glossError));
    const retry = el("button", "link-btn", t("deckRetry"));
    retry.type = "button";
    retry.addEventListener("click", fetchGlosses);
    note.append(retry);
    body.replaceChildren(note);
  } else {
    body.replaceChildren(el("p", "note", t("deckLoading")));
  }
}

// ---- the pile ----
const speak = (word) => {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);
};
const SPEAKER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

function makeCard(word, depth) {
  const card = el("article", "card fcard");
  card.dataset.word = word;
  card.style.setProperty("--depth", depth);
  card.style.zIndex = PILE - depth;
  const top = el("div", "fcard-top");
  top.append(el("span", "rank", `#${rank.get(word)}`));
  if (mode === "review") top.append(el("span", "tag", t(deck[word]?.s === "unsure" ? "deckUnsure" : "deckUnknown")));
  const listen = el("button", "icon-btn speak");
  listen.type = "button";
  listen.innerHTML = SPEAKER;
  listen.ariaLabel = listen.title = t("deckListen");
  listen.addEventListener("click", () => speak(word));
  top.append(listen);
  const front = el("div", "fword", word);
  front.lang = "en";
  const reveal = el("div", "freveal");
  reveal.append(el("div", "body"), el("div", "hint", t("deckTapHint")));
  card.append(top, front, el("div", "fpos"), reveal);
  for (const state of STATES) card.append(el("div", `stamp ${state}`, t(STAMP[state])));
  if (depth) card.ariaHidden = "true";
  else {
    card.classList.add("top");
    drag(card);
  }
  fillReveal(card);
  return card;
}
const STAMP = { known: "deckKnown", unsure: "deckUnsure", unknown: "deckUnknown" };

function renderPile() {
  const next = upcoming(PILE);
  const pile = $("pile");
  // Cards still flying off stay until their animation ends.
  for (const child of [...pile.children]) if (!child.classList.contains("flying")) child.remove();
  if (next.length) {
    pile.prepend(...next.map((word, depth) => makeCard(word, depth)));
  } else {
    const empty = el("div", "empty-state");
    if (mode === "new") empty.append(el("p", null, t("deckAllSeen")));
    else if (review.length) {
      const again = el("button", "btn secondary", t("deckReviewAgain"));
      again.addEventListener("click", () => {
        startReview();
        render();
      });
      empty.append(el("p", null, t("deckReviewDone")), again);
    } else empty.append(el("p", null, t("deckReviewEmpty")));
    pile.prepend(empty);
  }
  for (const button of document.querySelectorAll(".swipe-btn[data-state]")) button.disabled = !next.length;
  $("undo").disabled = !history.length;
  fetchGlosses();
}

const topCard = () => $("pile").querySelector(".fcard.top:not(.flying)");

// Throws the top card off in the swipe's direction and records the answer; the next card is ready at once.
function swipe(state) {
  const card = topCard();
  if (!card) return;
  const word = card.dataset.word;
  const [x, y] = { known: [1, 0], unknown: [-1, 0], unsure: [0, -1] }[state];
  const turn = state === "unsure" ? 0 : x * 24;
  card.classList.remove("dragging");
  card.classList.add("flying");
  card.querySelector(`.stamp.${state}`).style.opacity = 1;
  card.style.transform = `translate(${x * innerWidth}px, ${y * innerHeight}px) rotate(${turn}deg)`;
  history.push({ word, prev: deck[word]?.s ?? null, mode });
  deck[word] = { s: state, at: Date.now() };
  if (mode === "review") reviewAt++;
  mark(word, state);
  setTimeout(() => card.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 340);
  render();
}

function undo() {
  const last = history.pop();
  if (!last) return;
  if (last.prev) deck[last.word] = { s: last.prev, at: Date.now() };
  else delete deck[last.word];
  if (last.mode === "review" && mode === "review") reviewAt = Math.max(0, reviewAt - 1);
  mark(last.word, last.prev);
  render();
}

// Saves a word's state. Until every save is in, the stored deck lags behind the one here.
let saving = 0;
function mark(word, state) {
  saving++;
  chrome.runtime
    .sendMessage({ type: "deckMark", word, state })
    .catch(() => {})
    .finally(() => saving--);
}

// Dragging the top card: it follows the pointer and tilts, and the stamp for where it would go shows.
// A short press without movement turns the card over instead.
function drag(card) {
  let start = null;
  const direction = (dx, dy) => (dy < -40 && -dy > Math.abs(dx) ? "unsure" : dx > 0 ? "known" : "unknown");
  card.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button, a")) return;
    start = { x: e.clientX, y: e.clientY };
    card.setPointerCapture(e.pointerId);
    card.classList.add("dragging");
  });
  card.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const toward = direction(dx, dy);
    const strength = Math.min(1, Math.max(Math.abs(dx), toward === "unsure" ? -dy : 0) / THRESHOLD);
    for (const state of STATES) card.querySelector(`.stamp.${state}`).style.opacity = state === toward ? strength : 0;
  });
  const end = (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    card.classList.remove("dragging");
    if (Math.abs(dx) > THRESHOLD || (-dy > THRESHOLD && -dy > Math.abs(dx))) return swipe(direction(dx, dy));
    card.style.transform = "";
    for (const stamp of card.querySelectorAll(".stamp")) stamp.style.opacity = 0;
    if (e.type === "pointerup" && Math.hypot(dx, dy) < 6) card.classList.toggle("revealed");
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

// ---- side panel: progress and the lists ----
let list = "unknown";
function renderLists() {
  const by = { known: [], unsure: [], unknown: [] };
  for (const [word, { s }] of Object.entries(deck)) by[s]?.push(word);
  const seen = by.known.length + by.unsure.length + by.unknown.length;
  $("seen").textContent = t("deckSeen", seen.toLocaleString(), words.length.toLocaleString());
  const bars = document.querySelectorAll(".split span");
  STATES.forEach((state, i) => {
    $(`count${state[0].toUpperCase()}${state.slice(1)}`).textContent = by[state].length.toLocaleString();
    bars[i].style.flexBasis = `${words.length ? (by[state].length / words.length) * 100 : 0}%`;
  });
  for (const button of $("listTabs").children) {
    button.ariaSelected = String(button.dataset.list === list);
    button.querySelector(".count").textContent = by[button.dataset.list].length;
  }
  // Most recently swiped first.
  const shown = by[list].sort((a, b) => deck[b].at - deck[a].at);
  $("wordList").replaceChildren(
    ...(shown.length
      ? shown.map((word) => {
          const li = el("li");
          const b = el("b", null, word);
          b.lang = "en";
          li.append(b);
          if (glosses[word]) li.append(el("span", null, glosses[word].meaning));
          return li;
        })
      : [el("li", "empty", t("deckListEmpty"))])
  );
  const due = by.unknown.length + by.unsure.length;
  for (const button of document.querySelectorAll(".segtab[data-mode]")) {
    button.ariaSelected = String(button.dataset.mode === mode);
    button.querySelector(".count").textContent = (button.dataset.mode === "new" ? words.length - seen : due).toLocaleString();
  }
}

function render() {
  renderPile();
  renderLists();
}

// ---- wiring ----
for (const button of document.querySelectorAll(".segtab[data-mode]")) {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    if (mode === "review") startReview();
    render();
  });
}
for (const button of $("listTabs").children) {
  button.addEventListener("click", () => {
    list = button.dataset.list;
    renderLists();
  });
}
for (const button of document.querySelectorAll(".swipe-btn[data-state]")) {
  button.addEventListener("click", () => swipe(button.dataset.state));
}
$("undo").addEventListener("click", undo);
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest("input, select, textarea")) return;
  const action = {
    ArrowRight: () => swipe("known"),
    ArrowLeft: () => swipe("unknown"),
    ArrowUp: () => swipe("unsure"),
    " ": () => topCard()?.classList.toggle("revealed"),
    Backspace: undo,
  }[e.key];
  if (!action) return;
  e.preventDefault();
  action();
});

// Another open copy of this page, or a new language for the meanings.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.deck && !saving) {
    deck = changes.deck.newValue || {};
    renderLists();
  }
  if (changes.nativeLang || changes.apiKeys || changes.provider) location.reload();
});

(async () => {
  localizePage();
  const [text, settings, stored] = await Promise.all([
    fetch("core-words.txt").then((r) => r.text()),
    getSettings(),
    chrome.storage.local.get(["deck", "deckGlosses"]),
  ]);
  words = text.split("\n").filter((line) => line && !line.startsWith("#"));
  words.forEach((word, i) => rank.set(word, i + 1));
  deck = stored.deck || {};
  nativeLang = settings.nativeLang;
  hasKey = Boolean(settings.key);
  if (stored.deckGlosses?.lang === nativeLang) glosses = stored.deckGlosses.items;
  const learning = baseLang(settings.targetLang);
  if (learning !== "en") {
    $("notEnglish").textContent = t("deckNotEnglish", languageName(learning, chrome.i18n.getUILanguage()));
    $("notEnglish").hidden = false;
  }
  render();
})();
