// Sentences: grammar units with two kinds of exercise. "build" gives a sentence in your language and
// shuffled word tiles to put in order; "choice" gives a sentence with a gap and a few words for it. A
// lesson takes up to 10 items of a unit, the ones not mastered yet first; a wrong answer comes back at
// the end. Items answered right the first time count as mastered.
import { state, save, progress } from "./store.js";
import { t, pick } from "./i18n.js";
import * as data from "./data.js";
import { $, el, button, icon, badge, levelChips, speak } from "./ui.js";

const LESSON_SIZE = 10;
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

// ---- unit list ----
export async function showUnits(container) {
  container.replaceChildren(el("p", "empty", t("loading")));
  let units;
  try {
    units = await data.units(state.target);
  } catch {
    container.replaceChildren(el("p", "empty", t("loadFailed")));
    return;
  }
  loadNouns();
  const head = el("div", "view-head");
  const grid = el("div", "unit-grid");
  head.append(el("h1", null, t("navSentences")), levelChips(paint));
  container.replaceChildren(head, grid);
  function paint() {
    if (!units.length) return grid.replaceChildren(el("p", "empty", t("unitsSoon")));
    const shown = units.filter((u) => state.levels.includes(u.level));
    if (!shown.length) return grid.replaceChildren(el("p", "empty", t("noUnits")));
    grid.replaceChildren(
      ...shown.map((unit) => {
        const done = (mastered()[unit.id] || []).length;
        const card = button("unit", null, () => startLesson(unit, () => paint()));
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
  }
  paint();
}

// ---- a lesson ----
let lesson = null; // { unit, queue, total, right, firstTry, missed, onEnd }
let answer = null; // returns the learner's answer, or null while there isn't one
let checked = false; // false, true (showing the verdict) or "done" (summary)
let takeBack = null; // undoes the last tile placed, on build exercises

export const inLesson = () => Boolean(lesson);

function startLesson(unit, onEnd) {
  const done = new Set(mastered()[unit.id] || []);
  const order = shuffle(unit.items.map((_, i) => i));
  const queue = [...order.filter((i) => !done.has(i)), ...order.filter((i) => done.has(i))].slice(0, LESSON_SIZE);
  lesson = { unit, queue, total: queue.length, right: 0, firstTry: 0, missed: new Set(), onEnd };
  document.body.classList.add("in-lesson");
  $("lesson").hidden = false;
  $("lessonTitle").textContent = pick(unit.title, state.native);
  next();
}

function endLesson() {
  const { onEnd } = lesson;
  lesson = null;
  document.body.classList.remove("in-lesson");
  $("lesson").hidden = true;
  window.speechSynthesis?.cancel();
  onEnd?.();
}

function setProgress() {
  const pct = Math.round((lesson.right / lesson.total) * 100);
  $("lessonBar").firstElementChild.style.width = `${pct}%`;
  $("lessonBar").ariaValueNow = pct;
}

function next() {
  checked = false;
  takeBack = null;
  setProgress();
  $("sheet").className = "sheet";
  $("verdict").replaceChildren();
  $("check").textContent = t("check");
  $("check").disabled = true;
  if (!lesson.queue.length) return showSummary();
  const item = lesson.unit.items[lesson.queue[0]];
  const view = item.type === "build" ? buildView(item) : choiceView(item); // sets answer
  const exercise = $("exercise");
  exercise.replaceChildren(...view);
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
    if (checked) return;
    const at = chosen.indexOf(tile);
    if (at >= 0) {
      chosen.splice(at, 1);
      slot.append(tile);
    } else {
      slot.style.width = `${tile.offsetWidth}px`; // the empty place keeps the tile's size
      chosen.push(tile);
      line.append(tile);
    }
    $("check").disabled = !chosen.length;
  };
  for (const word of shuffle([...own, ...(item.extra || [])])) {
    const slot = el("span", "slot");
    const tile = button("tile", word, () => place(tile, slot));
    tile.slot = slot;
    slot.append(tile);
    bank.append(slot);
  }
  answer = () => (chosen.length ? chosen.map((x) => x.textContent).join(" ") : null);
  takeBack = () => chosen.length && place(chosen.at(-1), chosen.at(-1).slot);
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
      if (checked) return;
      picked = i;
      for (const o of options.children) o.ariaPressed = String(o === option);
      gap.textContent = text;
      gap.classList.add("filled");
      $("check").disabled = false;
    });
    option.lang = state.target;
    option.append(el("kbd", null, String(i + 1)), el("span", null, text));
    options.append(option);
  });
  answer = () => picked;
  return [el("h2", "ask", t("gapAsk")), sentence, meaning, options];
}

function check() {
  const index = lesson.queue[0];
  const item = lesson.unit.items[index];
  const given = answer?.();
  if (given == null) return;
  const right = item.type === "build" ? [item.text, ...(item.alt || [])].some((s) => same(s, given)) : given === item.answer;
  const full = item.type === "build" ? item.text : item.text.replace("___", item.options[item.answer]);
  checked = true;
  lesson.queue.shift();
  const done = new Set(mastered()[lesson.unit.id] || []);
  if (right) {
    lesson.right++;
    if (!lesson.missed.has(index)) {
      lesson.firstTry++;
      done.add(index);
    }
  } else {
    lesson.missed.add(index);
    lesson.queue.push(index); // comes back at the end
    done.delete(index);
  }
  mastered()[lesson.unit.id] = [...done];
  save();
  setProgress();
  if (item.type === "choice") {
    for (const [i, o] of [...$("exercise").querySelectorAll(".option")].entries()) {
      if (i === item.answer) o.classList.add("right");
      else if (o.ariaPressed === "true") o.classList.add("wrong");
    }
  }
  $("sheet").className = `sheet ${right ? "ok" : "bad"}`;
  const sentence = el("span", "full", full);
  sentence.lang = state.target;
  const listen = button("round-btn", null, () => speak(full));
  listen.append(icon("speaker"));
  listen.ariaLabel = t("listen");
  const text = el("div", "verdict-text");
  text.append(el("strong", null, t(right ? "correct" : "rightAnswer")), sentence);
  $("verdict").replaceChildren(icon(right ? "check" : "x", 3), text, listen);
  $("check").textContent = t("continue");
  navigator.vibrate?.(right ? 8 : [12, 60, 12]);
  speak(full);
}

function showSummary() {
  const accuracy = Math.round((lesson.firstTry / lesson.total) * 100);
  const box = el("div", "summary");
  const unit = lesson.unit;
  const onEnd = lesson.onEnd;
  box.append(
    el("span", "big", `${accuracy}%`),
    el("p", "summary-title", t(accuracy >= 80 ? "lessonGreat" : accuracy >= 50 ? "lessonGood" : "lessonMore")),
    el("p", "muted", t("lessonScore", lesson.total, lesson.firstTry)),
    button("btn", t("studyAgain"), () => startLesson(unit, onEnd))
  );
  $("exercise").replaceChildren(box);
  $("check").textContent = t("backToUnits");
  $("check").disabled = false;
  checked = "done";
}

export function wireLesson() {
  $("check").addEventListener("click", () => {
    if (checked === "done") endLesson();
    else if (checked) next();
    else check();
  });
  $("quit").addEventListener("click", endLesson);
}

// Keys during a lesson: 1–4 pick an option, Enter checks or goes on, Backspace takes back a tile.
export function lessonKey(e) {
  if (!lesson) return false;
  if (e.key === "Enter") {
    if (!$("check").disabled) $("check").click();
    return true;
  }
  if (e.key === "Escape") {
    endLesson();
    return true;
  }
  if (checked) return false;
  if (/^[1-9]$/.test(e.key)) {
    $("exercise").querySelectorAll(".option")[Number(e.key) - 1]?.click();
    return true;
  }
  if (e.key === "Backspace" && takeBack) {
    takeBack();
    return true;
  }
  return false;
}
