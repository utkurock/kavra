// The word deck: a pile of cards to swipe (right: known, left: don't know, up: not sure), Review of the
// words not known yet, and the lists of swiped words.
import { state, save, progress } from "./store.js";
import { t, posLabel } from "./i18n.js";
import * as data from "./data.js";
import { el, button, icon, badge, levelClass, levelChips, speak, reducedMotion, fmt } from "./ui.js";

const STATES = ["known", "unsure", "unknown"];
const PILE = 3; // cards drawn: the top one and two behind it
const THRESHOLD = 90; // pixels of drag that count as a swipe

let words = [];
let mode = "new"; // "new" or "review"
let review = [];
let reviewAt = 0;
let history = []; // swipes that can be undone: { word, prev, mode }
let root = null;

const deck = () => progress().deck;
const meaning = (w) => w[state.native] || w.tr || w.en;
const inLevels = (w) => state.levels.includes(w.level);

function upcoming(count) {
  if (mode === "review") return review.slice(reviewAt, reviewAt + count);
  const next = [];
  for (const w of words) {
    if (!deck()[w.word] && inLevels(w)) next.push(w);
    if (next.length === count) break;
  }
  return next;
}

// A review round: words you don't know first, then the ones you weren't sure of, most frequent first.
function startReview() {
  const order = { unknown: 0, unsure: 1 };
  const d = deck();
  review = words.filter((w) => inLevels(w) && d[w.word]?.s in order).sort((a, b) => order[d[a.word].s] - order[d[b.word].s] || a.rank - b.rank);
  reviewAt = 0;
}

function counts() {
  const by = { known: 0, unsure: 0, unknown: 0 };
  for (const { s } of Object.values(deck())) if (s in by) by[s]++;
  return by;
}

// ---- the study view ----
export async function showStudy(container) {
  root = container;
  history = [];
  mode = "new";
  root.replaceChildren(el("p", "empty", t("loading")));
  try {
    words = await data.words(state.target);
  } catch {
    root.replaceChildren(el("p", "empty", t("loadFailed")));
    return;
  }

  const head = el("div", "view-head");
  const title = el("h1", null, t("navWords"));
  const tabs = el("div", "seg");
  for (const m of ["new", "review"]) {
    const tab = button("seg-btn", null, () => {
      mode = m;
      if (m === "review") startReview();
      history = [];
      render();
    });
    tab.dataset.mode = m;
    tab.append(el("span", null, t(m === "new" ? "newWords" : "review")), el("span", "count"));
    tabs.append(tab);
  }
  head.append(title, levelChips(() => {
    if (mode === "review") startReview();
    render();
  }));

  const pile = el("div", "pile");
  pile.id = "pile";
  pile.ariaLive = "polite";
  const controls = el("div", "controls");
  const undoBtn = button("sbtn undo", null, undo);
  undoBtn.append(icon("undo", 2.2));
  undoBtn.ariaLabel = undoBtn.title = t("undo");
  controls.append(undoBtn);
  for (const [s, name] of [["unknown", "x"], ["unsure", "question"], ["known", "check"]]) {
    const b = button(`sbtn ${s}`, null, () => swipe(s));
    b.dataset.state = s;
    b.append(icon(name, 2.4));
    b.ariaLabel = b.title = t(s);
    controls.append(b);
  }
  const study = el("section", "study");
  study.append(tabs, pile, controls, el("p", "keys", t("keysHint")));

  // Beside the pile on wide screens: progress and the words missed lately.
  const side = el("aside", "side");
  const prog = el("section", "panel");
  prog.innerHTML = `<div class="panel-head"><h2></h2><span class="meta"></span></div>
    <div class="split"><span class="known"></span><span class="unsure"></span><span class="unknown"></span></div>
    <div class="tallies"></div>`;
  prog.querySelector("h2").textContent = t("progress");
  const recent = el("section", "panel");
  recent.append(el("div", "panel-head"), el("ul", "mini-list"));
  recent.firstChild.append(el("h2", null, t("recentUnknown")));
  side.append(prog, recent);

  const layout = el("div", "words-layout");
  layout.append(study, side);
  root.replaceChildren(head, layout);
  render();
}

function render() {
  if (!root?.isConnected) return;
  renderPile();
  renderSide();
}

function renderSide() {
  const by = counts();
  const seen = by.known + by.unsure + by.unknown;
  const shown = words.filter(inLevels);
  const d = deck();
  root.querySelector(".panel .meta").textContent = t("seen", fmt(seen), fmt(words.length));
  const bars = root.querySelectorAll(".split span");
  STATES.forEach((s, i) => (bars[i].style.flexBasis = `${words.length ? (by[s] / words.length) * 100 : 0}%`));
  root.querySelector(".tallies").replaceChildren(
    ...STATES.map((s) => {
      const tile = el("div", `tally ${s}`);
      tile.append(el("b", null, fmt(by[s])), el("span", null, t(s)));
      return tile;
    })
  );
  for (const tab of root.querySelectorAll(".seg-btn")) {
    tab.ariaPressed = String(tab.dataset.mode === mode);
    const n = tab.dataset.mode === "new" ? shown.filter((w) => !d[w.word]).length : shown.filter((w) => d[w.word] && d[w.word].s !== "known").length;
    tab.querySelector(".count").textContent = fmt(n);
  }
  const missed = words
    .filter((w) => d[w.word]?.s === "unknown")
    .sort((a, b) => d[b.word].at - d[a.word].at)
    .slice(0, 8);
  root.querySelector(".mini-list").replaceChildren(
    ...(missed.length ? missed.map((w) => wordRow(w)) : [el("li", "none", t("noneYet"))])
  );
}

export function wordRow(w, extra) {
  const li = el("li", "wrow");
  const word = el("b", null, w.head);
  word.lang = state.target;
  const m = el("span", "m", meaning(w));
  m.lang = state.native;
  li.append(badge(w.level), word, m);
  if (extra) li.append(extra);
  return li;
}

function makeCard(w, depth) {
  const card = el("article", `fcard ${levelClass(w.level)}`);
  card.dataset.word = w.word;
  card.style.setProperty("--depth", depth);
  card.style.zIndex = PILE - depth;
  const top = el("div", "corner");
  top.append(badge(w.level), el("span", "rank", `#${w.rank}`));
  if (mode === "review") top.append(el("span", "state", t(deck()[w.word]?.s)));
  const listen = button("round-btn speak", null, () => speak(w.head));
  listen.append(icon("speaker"));
  listen.ariaLabel = listen.title = t("listen");
  top.append(listen);
  const word = el("div", "fword", w.head);
  word.lang = state.target;
  const reveal = el("div", "freveal");
  const m = el("p", "meaning", meaning(w));
  m.lang = state.native;
  reveal.append(m, el("div", "hint", t("tapForMeaning")));
  const bottom = el("div", "corner bottom");
  bottom.append(badge(w.level));
  card.append(top, word, el("div", "fpos", posLabel(w.pos)), reveal, bottom);
  for (const s of STATES) card.append(el("div", `stamp ${s}`, t(s)));
  if (depth) card.ariaHidden = "true";
  else {
    card.classList.add("top");
    drag(card);
  }
  return card;
}

function renderPile() {
  const pile = root.querySelector("#pile");
  const next = upcoming(PILE);
  for (const child of [...pile.children]) if (!child.classList.contains("flying")) child.remove();
  if (next.length) pile.prepend(...next.map((w, depth) => makeCard(w, depth)));
  else {
    const empty = el("div", "pile-empty");
    if (!state.levels.length) empty.append(el("p", null, t("pickLevel")));
    else if (mode === "new") empty.append(el("p", null, t("allSeen")));
    else if (review.length) {
      empty.append(
        el("p", null, t("roundDone")),
        button("btn", t("goAgain"), () => {
          startReview();
          render();
        })
      );
    } else empty.append(el("p", null, t("nothingToReview")));
    pile.prepend(empty);
  }
  for (const b of root.querySelectorAll(".sbtn[data-state]")) b.disabled = !next.length;
  root.querySelector(".sbtn.undo").disabled = !history.length;
}

const topCard = () => root?.querySelector(".fcard.top:not(.flying)");

// Throws the top card off in the swipe's direction and records the answer; the next card is ready at once.
function swipe(s) {
  const card = topCard();
  if (!card) return;
  const word = card.dataset.word;
  const [x, y] = { known: [1, 0], unknown: [-1, 0], unsure: [0, -1] }[s];
  card.classList.remove("dragging");
  card.classList.add("flying");
  card.querySelector(`.stamp.${s}`).style.opacity = 1;
  card.style.transform = `translate(${x * innerWidth}px, ${y * innerHeight}px) rotate(${x * 24}deg)`;
  history.push({ word, prev: deck()[word]?.s ?? null, mode });
  deck()[word] = { s, at: Date.now() };
  if (mode === "review") reviewAt++;
  save();
  navigator.vibrate?.(8);
  setTimeout(() => card.remove(), reducedMotion() ? 0 : 340);
  render();
}

function undo() {
  const last = history.pop();
  if (!last) return;
  if (last.prev) deck()[last.word] = { s: last.prev, at: Date.now() };
  else delete deck()[last.word];
  if (last.mode === "review" && mode === "review") reviewAt = Math.max(0, reviewAt - 1);
  save();
  render();
}

// The top card follows the finger and tilts; the stamp for where it would go fades in. A tap turns it over.
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
    for (const s of STATES) card.querySelector(`.stamp.${s}`).style.opacity = s === toward ? strength : 0;
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

// Keys while the study view is open.
export function studyKey(e) {
  if (!topCard() && e.key !== "Backspace") return false;
  const action = {
    ArrowRight: () => swipe("known"),
    ArrowLeft: () => swipe("unknown"),
    ArrowUp: () => swipe("unsure"),
    " ": () => topCard()?.classList.toggle("revealed"),
    Backspace: undo,
  }[e.key];
  if (!action) return false;
  action();
  return true;
}

// ---- the lists view: swiped words by state, searchable, each can be asked again ----
let list = "unknown";
export async function showLists(container) {
  container.replaceChildren(el("p", "empty", t("loading")));
  try {
    words = await data.words(state.target);
  } catch {
    container.replaceChildren(el("p", "empty", t("loadFailed")));
    return;
  }
  const head = el("div", "view-head");
  const searchBox = el("label", "search");
  const input = el("input");
  Object.assign(input, { type: "search", placeholder: t("search") });
  input.ariaLabel = t("search");
  searchBox.append(icon("search"), input);
  const tabs = el("div", "seg");
  for (const s of ["unknown", "unsure", "known"]) {
    const tab = button("seg-btn", null, () => {
      list = s;
      paint();
    });
    tab.dataset.list = s;
    tab.append(el("span", `dot ${s}`), el("span", null, t(s)), el("span", "count"));
    tabs.append(tab);
  }
  head.append(el("h1", null, t("navLists")), levelChips(() => paint()));
  let matching = []; // the words of the open list, as filtered: what the export holds
  const exportBtn = button("btn", t("exportCsv"), () => exportCsv(matching, list));
  exportBtn.prepend(icon("download"));
  const bar = el("div", "list-bar");
  bar.append(tabs, searchBox, exportBtn);
  const ul = el("ul", "word-list");
  container.replaceChildren(head, bar, ul);
  input.addEventListener("input", paint);

  function paint() {
    const d = deck();
    const groups = { known: [], unsure: [], unknown: [] };
    for (const w of words) if (inLevels(w) && d[w.word]) groups[d[w.word].s]?.push(w);
    for (const tab of tabs.children) {
      tab.ariaPressed = String(tab.dataset.list === list);
      tab.querySelector(".count").textContent = fmt(groups[tab.dataset.list].length);
    }
    const q = input.value.trim().toLocaleLowerCase();
    matching = groups[list]
      .filter((w) => !q || `${w.head} ${meaning(w)}`.toLocaleLowerCase().includes(q))
      .sort((a, b) => d[b.word].at - d[a.word].at);
    exportBtn.disabled = !matching.length;
    const shown = matching.slice(0, 500);
    ul.replaceChildren(
      ...(shown.length
        ? shown.map((w) => {
            const again = button("round-btn", null, () => {
              delete d[w.word];
              save();
              paint();
            });
            again.append(icon("reset"));
            again.ariaLabel = again.title = t("askAgain");
            const listen = button("round-btn", null, () => speak(w.head));
            listen.append(icon("speaker"));
            listen.ariaLabel = listen.title = t("listen");
            const actions = el("span", "row-actions");
            actions.append(listen, again);
            return wordRow(w, actions);
          })
        : [el("li", "none", t("noneYet"))])
    );
  }
  paint();
}

// Downloads words as a CSV file (opens in Excel, Google Sheets, or Anki's import): the word as shown,
// its meaning, level, part of speech and state. A byte-order mark lets Excel read the accents.
function exportCsv(list, listState) {
  const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const rows = [
    [t("csvWord"), t("csvMeaning"), t("csvLevel"), t("csvPos"), t("csvState")],
    ...list.map((w) => [w.head, meaning(w), w.level, posLabel(w.pos), t(deck()[w.word]?.s || listState)]),
  ];
  const csv = "\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  const date = new Date().toISOString().slice(0, 10);
  const link = el("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `5000-${state.target}-${listState}-${date}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
