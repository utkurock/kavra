// Sentences: practice that starts right away, like the word cards. Exercises come one after another
// from the grammar units in the chosen levels (or from one topic, picked in the Topics tab), the ones
// not mastered yet first. "build" gives a sentence in your language and shuffled word tiles to put in
// order; "choice" gives a sentence with a gap and a few words for it. A wrong answer comes back a few
// exercises later; one answered right the first time counts as mastered.
import { state, save, progress } from "./store.js";
import { t, pick } from "./i18n.js";
import * as data from "./data.js";
import { el, button, icon, badge, levelChips, speak, toast } from "./ui.js";

const RETRY_AFTER = 3; // a missed exercise comes back after this many others
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// Words as tiles: punctuation off, case kept.
const tiles = (sentence) => sentence.replace(/[.?!,;:¿¡«»]/g, " ").split(/\s+/).filter(Boolean);
const same = (a, b) => tiles(a).join(" ").toLowerCase() === tiles(b).join(" ").toLowerCase();
const native = (item) => pick(item.native, state.native);
const mastered = () => progress().lessons;

// German nouns keep their capital letter: taken from the deck, where nouns are shown as "das Haus".
let nouns = new Set();
async function loadNouns() {
  if (state.target !== "de") return (nouns = new Set());
  const words = await data.words("de").catch(() => []);
  nouns = new Set(words.map((w) => w.head.split(" ").at(-1)).filter((x) => /^\p{Lu}/u.test(x)));
}

let units = [];
let tab = "practice"; // or "topics"
let focus = null; // a unit to practise on its own, or null for all units in the chosen levels
let s = null; // the practice session: { queue, missed, right, wrong, els, answer, takeBack, checked }
let root = null;

// ---- the view: practice, or the list of topics ----
export async function showSentences(container) {
  root = container;
  container.replaceChildren(el("p", "empty", t("loading")));
  try {
    units = await data.units(state.target);
  } catch {
    container.replaceChildren(el("p", "empty", t("loadFailed")));
    return;
  }
  await loadNouns();
  if (focus && !units.includes(focus)) focus = null; // another language since
  const head = el("div", "view-head");
  head.append(
    el("h1", null, t("navSentences")),
    levelChips(() => {
      focus = null;
      render();
    })
  );
  const tabs = el("div", "seg sent-tabs");
  for (const name of ["practice", "topics"]) {
    const b = button("seg-btn", t(name), () => {
      tab = name;
      render();
    });
    b.dataset.tab = name;
    tabs.append(b);
  }
  const body = el("div", "sent-body");
  container.replaceChildren(head, tabs, body);
  render();
}

function render() {
  if (!root?.isConnected) return;
  for (const b of root.querySelectorAll(".sent-tabs .seg-btn")) b.ariaPressed = String(b.dataset.tab === tab);
  const body = root.querySelector(".sent-body");
  if (!units.length) return body.replaceChildren(el("p", "empty", t("unitsSoon")));
  if (tab === "topics") return showTopics(body);
  startPractice(body);
}

function showTopics(body) {
  const shown = units.filter((u) => state.levels.includes(u.level));
  if (!shown.length) return body.replaceChildren(el("p", "empty", t("noUnits")));
  const grid = el("div", "unit-grid");
  grid.append(
    ...shown.map((unit) => {
      const done = (mastered()[unit.id] || []).length;
      const card = button("unit", null, () => {
        focus = unit;
        tab = "practice";
        render();
      });
      const top = el("div", "unit-top");
      top.append(badge(unit.level), el("span", "unit-count", `${done}/${unit.items.length}`));
      const bar = el("div", "bar");
      const fill = el("span");
      fill.style.width = `${(done / unit.items.length) * 100}%`;
      bar.append(fill);
      card.append(top, el("span", "unit-title", pick(unit.title, state.native)), el("span", "unit-tip", pick(unit.tip, state.native)), bar);
      if (done === unit.items.length) card.classList.add("complete");
      return card;
    })
  );
  body.replaceChildren(grid);
}

// ---- practice ----
// The exercises to go through: not-mastered ones first, a couple of units at a time in course order,
// shuffled within; once all are mastered, everything again in random order.
function buildQueue() {
  const pool = focus ? [focus] : units.filter((u) => state.levels.includes(u.level));
  const open = [];
  const done = [];
  for (let k = 0; k < pool.length; k += 2) {
    const block = [];
    for (const unit of pool.slice(k, k + 2)) {
      const m = new Set(mastered()[unit.id] || []);
      unit.items.forEach((_, i) => (m.has(i) ? done : block).push({ unit, i }));
    }
    open.push(...shuffle(block));
  }
  if (open.length) return open;
  if (done.length) toast(t("allMastered"));
  return shuffle(done);
}

function startPractice(body) {
  const box = el("section", "practice");
  const top = el("div", "practice-top");
  const exercise = el("div", "exercise");
  const verdict = el("div", "verdict");
  verdict.ariaLive = "polite";
  const check = button("btn primary big", t("check"), () => (s.checked ? next() : grade()));
  const sheet = el("div", "sheet");
  const inner = el("div", "sheet-inner");
  inner.append(verdict, check);
  sheet.append(inner);
  box.append(top, exercise, sheet);
  body.replaceChildren(box, el("p", "keys", t("practiceKeys")));
  s = { queue: buildQueue(), right: 0, wrong: 0, missed: new Set(), els: { top, exercise, verdict, check, sheet }, checked: false };
  if (!s.queue.length) return body.replaceChildren(el("p", "empty", t("noUnits")));
  next();
}

function paintTop(unit) {
  const { top } = s.els;
  const topic = el("div", "topic");
  topic.append(badge(unit.level), el("span", "topic-title", pick(unit.title, state.native)));
  const tally = el("div", "tally-line");
  const ok = el("span", "ok");
  ok.append(icon("check", 3), String(s.right));
  const bad = el("span", "bad");
  bad.append(icon("x", 3), String(s.wrong));
  tally.append(ok, bad);
  top.replaceChildren(topic, tally);
  if (focus) {
    const all = button("chip-btn", t("allTopics"), () => {
      focus = null;
      render();
    });
    all.prepend(icon("x"));
    top.append(all);
  }
}

function next() {
  if (!s.queue.length) s.queue = buildQueue();
  const { unit, i } = s.queue[0];
  const item = unit.items[i];
  s.checked = false;
  s.takeBack = null;
  const { exercise, verdict, check, sheet } = s.els;
  paintTop(unit);
  sheet.className = "sheet";
  verdict.replaceChildren();
  check.textContent = t("check");
  check.disabled = true;
  exercise.replaceChildren(...(item.type === "build" ? buildView(item) : choiceView(item))); // sets s.answer
  exercise.classList.remove("enter");
  void exercise.offsetWidth; // restart the entrance animation
  exercise.classList.add("enter");
}

// Tiles move from the bank to the answer line and back; a used tile leaves its place in the bank.
function buildView(item) {
  const prompt = el("p", "prompt", native(item));
  prompt.lang = state.native;
  const line = el("div", "answer-line");
  line.lang = state.target;
  const bank = el("div", "bank");
  bank.lang = state.target;
  const chosen = [];
  // The first word in lower case, so its capital doesn't give it away — not where the case matters:
  // English "I", German nouns, or a name that's also in the translation.
  const own = tiles(item.text);
  const first = own[0];
  if (!(state.target === "en" && first === "I") && !nouns.has(first) && !native(item).includes(first)) {
    own[0] = first[0].toLocaleLowerCase(state.target) + first.slice(1);
  }
  const place = (tile, slot) => {
    if (s.checked) return;
    const at = chosen.indexOf(tile);
    if (at >= 0) {
      chosen.splice(at, 1);
      slot.append(tile);
    } else {
      slot.style.width = `${tile.offsetWidth}px`; // the empty place keeps the tile's size
      chosen.push(tile);
      line.append(tile);
    }
    s.els.check.disabled = !chosen.length;
  };
  for (const word of shuffle([...own, ...(item.extra || [])])) {
    const slot = el("span", "slot");
    const tile = button("tile", word, () => place(tile, slot));
    tile.slot = slot;
    slot.append(tile);
    bank.append(slot);
  }
  s.answer = () => (chosen.length ? chosen.map((x) => x.textContent).join(" ") : null);
  s.takeBack = () => chosen.length && place(chosen.at(-1), chosen.at(-1).slot);
  return [el("h2", "ask", t("buildAsk")), prompt, line, bank];
}

function choiceView(item) {
  const sentence = el("p", "gap-sentence");
  sentence.lang = state.target;
  const [before, after] = item.text.split("___");
  const gap = el("span", "gap", " ");
  sentence.append(before, gap, after);
  const meaning = el("p", "gap-meaning", native(item));
  meaning.lang = state.native;
  const options = el("div", "options");
  let picked = null;
  item.options.forEach((text, i) => {
    const option = button("option", null, () => {
      if (s.checked) return;
      picked = i;
      for (const o of options.children) o.ariaPressed = String(o === option);
      gap.textContent = text;
      gap.classList.add("filled");
      s.els.check.disabled = false;
    });
    option.lang = state.target;
    option.append(el("kbd", null, String(i + 1)), el("span", null, text));
    options.append(option);
  });
  s.answer = () => picked;
  return [el("h2", "ask", t("gapAsk")), sentence, meaning, options];
}

function grade() {
  const entry = s.queue[0];
  const { unit, i } = entry;
  const item = unit.items[i];
  const given = s.answer?.();
  if (given == null) return;
  const right = item.type === "build" ? [item.text, ...(item.alt || [])].some((x) => same(x, given)) : given === item.answer;
  const full = item.type === "build" ? item.text : item.text.replace("___", item.options[item.answer]);
  s.checked = true;
  s.queue.shift();
  const done = new Set(mastered()[unit.id] || []);
  const key = `${unit.id}:${i}`;
  if (right) {
    s.right++;
    if (!s.missed.has(key)) done.add(i);
  } else {
    s.wrong++;
    s.missed.add(key);
    s.queue.splice(Math.min(RETRY_AFTER, s.queue.length), 0, entry); // comes back a little later
    done.delete(i);
  }
  mastered()[unit.id] = [...done];
  save();
  paintTop(unit);
  const { exercise, verdict, check, sheet } = s.els;
  if (item.type === "choice") {
    for (const [k, o] of [...exercise.querySelectorAll(".option")].entries()) {
      if (k === item.answer) o.classList.add("right");
      else if (o.ariaPressed === "true") o.classList.add("wrong");
    }
  }
  sheet.className = `sheet ${right ? "ok" : "bad"}`;
  const sentence = el("span", "full", full);
  sentence.lang = state.target;
  const listen = button("round-btn", null, () => speak(full));
  listen.append(icon("speaker"));
  listen.ariaLabel = t("listen");
  const text = el("div", "verdict-text");
  text.append(el("strong", null, t(right ? "correct" : "rightAnswer")), sentence);
  verdict.replaceChildren(icon(right ? "check" : "x", 3), text, listen);
  check.textContent = t("continue");
  check.disabled = false;
  navigator.vibrate?.(right ? 8 : [12, 60, 12]);
  speak(full);
}

// Keys while practising: 1–4 pick an option, Enter checks or goes on, Backspace takes back a tile.
export function sentenceKey(e) {
  if (!s || !s.els.check.isConnected) return false;
  if (e.key === "Enter") {
    if (!s.els.check.disabled) s.els.check.click();
    return true;
  }
  if (s.checked) return false;
  if (/^[1-9]$/.test(e.key)) {
    s.els.exercise.querySelectorAll(".option")[Number(e.key) - 1]?.click();
    return true;
  }
  if (e.key === "Backspace" && s.takeBack) {
    s.takeBack();
    return true;
  }
  return false;
}
