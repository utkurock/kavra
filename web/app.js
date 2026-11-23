// 5000 Kelime: the most frequent English words as a pile of cards, with Turkish meanings and a CEFR
// level each. Swipe right (→) for a word you know, left (←) for one you don't, up (↑) when you're not
// sure. The Sentences section (sentences.js) shares the level filter. Progress stays in this browser.
const $ = (id) => document.getElementById(id);
const STATES = ["known", "unsure", "unknown"];
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const LABEL = { known: "Biliyorum", unsure: "Emin değilim", unknown: "Bilmiyorum" };
const PILE = 3; // cards drawn: the top one and two behind it
const THRESHOLD = 90; // pixels of drag that count as a swipe
const SAVE_KEY = "kelime.v1";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const levelClass = (level) => level[0].toLowerCase(); // "a", "b" or "c"

let words = []; // { word, level, pos, meaning, rank }, most frequent first
let deck = {}; // word -> { s, at }
let levels = new Set(LEVELS);
let mode = "words"; // "words" or "sentences"
let view = "new";
let list = "unknown";
let review = [];
let reviewAt = 0;
const history = []; // { word, prev, view }

// ---- saved progress (this browser only) ----
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
    deck = saved.deck || {};
    if (Array.isArray(saved.levels) && saved.levels.length) levels = new Set(saved.levels.filter((l) => LEVELS.includes(l)));
    if (saved.mode === "sentences") mode = "sentences";
  } catch {
    // private mode or blocked storage: start fresh, nothing is kept
  }
}
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ deck, levels: [...levels], mode }));
  } catch {
    // storage full or blocked
  }
}

// ---- what comes next ----
const inLevels = (w) => levels.has(w.level);
function upcoming(count) {
  if (view === "review") return review.slice(reviewAt, reviewAt + count);
  const next = [];
  for (const w of words) {
    if (!deck[w.word] && inLevels(w)) next.push(w);
    if (next.length === count) break;
  }
  return next;
}

// A review round: words you don't know first, then the ones you weren't sure of, most frequent first.
function startReview() {
  const order = { unknown: 0, unsure: 1 };
  review = words
    .filter((w) => inLevels(w) && deck[w.word]?.s in order)
    .sort((a, b) => order[deck[a.word].s] - order[deck[b.word].s] || a.rank - b.rank);
  reviewAt = 0;
}

// ---- the pile ----
const SPEAKER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
function speak(word) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);
}
const badge = (level) => el("span", `badge ${levelClass(level)}`, level);

function makeCard(w, depth) {
  const card = el("article", "fcard");
  card.dataset.word = w.word;
  card.style.setProperty("--depth", depth);
  card.style.zIndex = PILE - depth;
  // The level in two corners, like a playing card.
  const top = el("div", "corner");
  top.append(badge(w.level), el("span", "rank", `#${w.rank}`));
  if (view === "review") top.append(el("span", "state", LABEL[deck[w.word]?.s]));
  const listen = el("button", "speak");
  listen.type = "button";
  listen.innerHTML = SPEAKER;
  listen.ariaLabel = "Dinle";
  listen.addEventListener("click", () => speak(w.word));
  top.append(listen);
  const word = el("div", "fword", w.word);
  word.lang = "en";
  const reveal = el("div", "freveal");
  reveal.append(el("p", "meaning", w.meaning), el("div", "hint", "Anlamı için dokun"));
  const bottom = el("div", "corner bottom");
  bottom.append(badge(w.level));
  card.append(top, word, el("div", "fpos", w.pos), reveal, bottom);
  for (const state of STATES) card.append(el("div", `stamp ${state}`, LABEL[state]));
  if (depth) card.ariaHidden = "true";
  else {
    card.classList.add("top");
    drag(card);
  }
  return card;
}

function renderPile() {
  const next = upcoming(PILE);
  const pile = $("pile");
  // Cards still flying off stay until their animation ends.
  for (const child of [...pile.children]) if (!child.classList.contains("flying")) child.remove();
  if (next.length) pile.prepend(...next.map((w, depth) => makeCard(w, depth)));
  else {
    const empty = el("div", "empty");
    if (!levels.size) empty.append(el("p", null, "Yukarıdan en az bir seviye seç."));
    else if (view === "new") empty.append(el("p", null, "Seçtiğin seviyelerdeki bütün kelimeleri gördün. Bilmediklerini Tekrar'dan çalış."));
    else if (review.length) {
      const again = el("button", "btn", "Yeniden başla");
      again.addEventListener("click", () => {
        startReview();
        render();
      });
      empty.append(el("p", null, "Tur bitti."), again);
    } else empty.append(el("p", null, "Tekrar edilecek kelime yok. Sola ya da yukarı kaydırdıkların buraya gelir."));
    pile.prepend(empty);
  }
  for (const button of document.querySelectorAll(".sbtn[data-state]")) button.disabled = !next.length;
  $("undo").disabled = !history.length;
}

const topCard = () => $("pile").querySelector(".fcard.top:not(.flying)");

// Throws the top card off in the swipe's direction and records the answer; the next card is ready at once.
function swipe(state) {
  const card = topCard();
  if (!card) return;
  const word = card.dataset.word;
  const [x, y] = { known: [1, 0], unknown: [-1, 0], unsure: [0, -1] }[state];
  card.classList.remove("dragging");
  card.classList.add("flying");
  card.querySelector(`.stamp.${state}`).style.opacity = 1;
  card.style.transform = `translate(${x * innerWidth}px, ${y * innerHeight}px) rotate(${x * 24}deg)`;
  history.push({ word, prev: deck[word]?.s ?? null, view });
  deck[word] = { s: state, at: Date.now() };
  if (view === "review") reviewAt++;
  save();
  navigator.vibrate?.(8);
  setTimeout(() => card.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 340);
  render();
}

function undo() {
  const last = history.pop();
  if (!last) return;
  if (last.prev) deck[last.word] = { s: last.prev, at: Date.now() };
  else delete deck[last.word];
  if (last.view === "review" && view === "review") reviewAt = Math.max(0, reviewAt - 1);
  save();
  render();
}

// Dragging the top card: it follows the finger and tilts, and the stamp for where it would go shows.
// A tap without movement turns the card over instead.
function drag(card) {
  let start = null;
  const direction = (dx, dy) => (dy < -40 && -dy > Math.abs(dx) ? "unsure" : dx > 0 ? "known" : "unknown");
  card.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    start = { x: e.clientX, y: e.clientY };
    card.setPointerCapture(e.pointerId);
    card.classList.add("dragging");
  });
  card.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 16}deg)`;
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
    if (e.type === "pointerup" && Math.hypot(dx, dy) < 8) card.classList.toggle("revealed");
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

// ---- header and lists ----
function renderHeader() {
  const by = { known: 0, unsure: 0, unknown: 0 };
  for (const { s } of Object.values(deck)) if (s in by) by[s]++;
  const seen = by.known + by.unsure + by.unknown;
  $("seen").textContent = `${seen.toLocaleString("tr")} / ${words.length.toLocaleString("tr")} görüldü`;
  const bars = document.querySelectorAll(".split span");
  STATES.forEach((state, i) => (bars[i].style.flexBasis = `${words.length ? (by[state] / words.length) * 100 : 0}%`));
  for (const button of $("levels").children) button.ariaPressed = String(levels.has(button.dataset.level));
  const shown = words.filter(inLevels);
  const counts = {
    new: shown.filter((w) => !deck[w.word]).length,
    review: shown.filter((w) => deck[w.word] && deck[w.word].s !== "known").length,
  };
  for (const button of document.querySelectorAll(".modes button")) {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    save();
    render();
  });
}
for (const button of document.querySelectorAll(".tabs button")) {
    button.ariaSelected = String(button.dataset.view === view);
    const count = button.querySelector(".count");
    if (count) count.textContent = counts[button.dataset.view].toLocaleString("tr");
  }
}

function renderLists() {
  const groups = { known: [], unsure: [], unknown: [] };
  for (const w of words) if (inLevels(w) && deck[w.word]) groups[deck[w.word].s]?.push(w);
  for (const button of $("listTabs").children) {
    button.ariaSelected = String(button.dataset.list === list);
    button.querySelector(".count").textContent = groups[button.dataset.list].length;
  }
  // Most recently swiped first.
  const shown = groups[list].sort((a, b) => deck[b.word].at - deck[a.word].at);
  $("wordList").replaceChildren(
    ...(shown.length
      ? shown.map((w) => {
          const li = el("li");
          const b = el("b", null, w.word);
          b.lang = "en";
          li.append(b, el("span", "m", w.meaning), badge(w.level));
          return li;
        })
      : [el("li", "none", "Burada henüz kelime yok.")])
  );
}

function render() {
  renderHeader();
  document.body.dataset.mode = mode;
  for (const button of document.querySelectorAll(".modes button")) button.ariaSelected = String(button.dataset.mode === mode);
  const inWords = mode === "words";
  $("study").hidden = !inWords || view === "lists";
  $("lists").hidden = !inWords || view !== "lists";
  $("units").hidden = inWords;
  if (!inWords) Sentences.showUnits(levels);
  else if (view === "lists") renderLists();
  else renderPile();
}

// ---- wiring ----
for (const level of LEVELS) {
  const button = el("button", `level ${levelClass(level)}`, level);
  button.type = "button";
  button.dataset.level = level;
  button.addEventListener("click", () => {
    if (levels.has(level)) levels.delete(level);
    else levels.add(level);
    save();
    if (view === "review") startReview();
    render();
  });
  $("levels").append(button);
}
for (const button of document.querySelectorAll(".modes button")) {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    save();
    render();
  });
}
for (const button of document.querySelectorAll(".tabs button")) {
  button.addEventListener("click", () => {
    view = button.dataset.view;
    if (view === "review") startReview();
    render();
  });
}
for (const button of $("listTabs").children) {
  button.addEventListener("click", () => {
    list = button.dataset.list;
    renderLists();
  });
}
for (const button of document.querySelectorAll(".sbtn[data-state]")) button.addEventListener("click", () => swipe(button.dataset.state));
$("undo").addEventListener("click", undo);
document.addEventListener("keydown", (e) => {
  if (mode !== "words" || view === "lists" || e.metaKey || e.ctrlKey || e.altKey) return;
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

(async () => {
  load();
  const text = await (await fetch("words.tsv")).text();
  words = text
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line, i) => {
      const [word, level, pos, meaning] = line.split("\t");
      return { word, level: LEVELS.includes(level) ? level : "C2", pos: pos || "", meaning: meaning || "", rank: i + 1 };
    });
  render();
})();
