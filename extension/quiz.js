const { t, localizePage, timeAgo, languageName } = globalThis.Kavra;
const $ = (id) => document.getElementById(id);
const KIND = {
  comprehension: "kindComprehension",
  vocabulary: "kindVocabulary",
  listening: "kindListening",
  fill: "kindFill",
  translation: "kindTranslation",
};
// Kinds where showing the quoted line would give the answer away: it fills the gap, or it is the
// sentence the translation asks for.
const HIDE_QUOTE = new Set(["listening", "fill", "translation"]);
const LETTERS = "ABCDEFGH";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const ui = chrome.i18n.getUILanguage();
const svg = (paths) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  `stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const BADGES = {
  video: { label: "quizKindVideo", colour: "var(--hue-2)", icon: svg('<path d="M7 5v14l11-7z"/>') },
  words: { label: "quizKindWords", colour: "var(--hue-1)", icon: svg('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>') },
};

const quizTitle = (quiz) => (quiz.from === "words" ? t("wordQuizTitle") : quiz.title || t("quizTitle"));
// How far a quiz got: answered and correct counts.
function tally(quiz) {
  const answers = (quiz.answers || []).map((a, i) => [a, quiz.questions[i]]).filter(([a, q]) => a != null && q);
  return {
    total: quiz.questions.length,
    answered: answers.length,
    correct: answers.filter(([a, q]) => a === q.correct_index).length,
  };
}
const stateOf = ({ total, answered }) => (answered === 0 ? "new" : answered < total ? "open" : "done");

// ---- overview: every quiz as a card ----
let tab = "all";
function showOverview(quizzes) {
  $("overview").hidden = false;
  const states = quizzes.map((q) => stateOf(tally(q)));
  const inTab = (i) => tab === "all" || (tab === "done" ? states[i] === "done" : states[i] !== "done");
  for (const button of document.querySelectorAll(".segtab")) {
    const name = button.dataset.tab;
    button.ariaSelected = String(name === tab);
    button.querySelector(".count").textContent =
      name === "all" ? quizzes.length : states.filter((st) => (name === "done" ? st === "done" : st !== "done")).length;
  }
  const cards = quizzes.flatMap((quiz, i) => (inTab(i) ? [quizCard(quiz, states[i])] : []));
  $("quizList").replaceChildren(...cards);
  $("quizzesEmpty").hidden = cards.length > 0;
}

function quizCard(quiz, state) {
  const { total, answered, correct } = tally(quiz);
  const kind = BADGES[quiz.from === "words" ? "words" : "video"];
  const li = el("li");
  const link = el("a", "card qcard");
  link.href = `quiz.html?id=${encodeURIComponent(quiz.id)}`;
  const top = el("div", "qcard-top");
  const badge = el("span", "badge");
  badge.innerHTML = kind.icon;
  badge.append(t(kind.label));
  badge.style.setProperty("--c", kind.colour);
  top.append(badge, el("span", "when", timeAgo(quiz.createdAt)));
  const sub = [t("questionCount", total)];
  if (quiz.lang) sub.push(languageName(quiz.lang, ui));
  const foot = el("div", "qcard-foot");
  const bar = el("div", "progress");
  const fill = el("span");
  fill.style.width = `${Math.round((answered / total) * 100)}%`;
  bar.append(fill);
  foot.append(
    el("span", null, state === "done" ? t("score", correct, total) : t("answeredOf", answered, total)),
    bar,
    el("span", `tag ${state}`, t({ new: "quizStateNew", open: "quizStateOpen", done: "quizStateDone" }[state]))
  );
  link.append(top, el("div", "qcard-title", quizTitle(quiz)), el("div", "qcard-sub", sub.join(" · ")), foot);
  li.append(link);
  return li;
}

// ---- one quiz: its questions, with progress and the result beside them ----
function showQuiz(quiz) {
  $("detail").hidden = false;
  const lang = quiz.lang || "";
  $("title").textContent = quizTitle(quiz);
  document.title = quizTitle(quiz);
  const total = quiz.questions.length;
  const date = new Date(quiz.createdAt).toLocaleString(chrome.i18n.getUILanguage(), { dateStyle: "medium", timeStyle: "short" });
  $("meta").textContent = `${date} · ${t("questionCount", total)}`;
  $("progressWrap").hidden = false;

  let answered = 0;
  let correct = 0;
  function updateProgress() {
    const pct = Math.round((answered / total) * 100);
    $("progressBar").firstElementChild.style.width = `${pct}%`;
    $("progressBar").ariaValueNow = pct;
    $("progressText").textContent = t("answeredOf", answered, total);
    $("scoreText").textContent = answered ? t("score", correct, answered) : "";
    if (answered === total) showSummary();
  }

  function showSummary() {
    $("summaryScore").textContent = `${correct}/${total}`;
    const ratio = correct / total;
    $("summaryText").textContent = t(ratio >= 0.8 ? "summaryGreat" : ratio >= 0.5 ? "summaryGood" : "summaryKeepGoing");
    $("summary").hidden = false;
    $("summary").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  quiz.questions.forEach((q, i) => {
    const card = el("section", "card q");
    card.setAttribute("aria-labelledby", `q${i}`);
    card.append(el("span", `kind ${q.kind}`, `${i + 1} · ${KIND[q.kind] ? t(KIND[q.kind]) : q.kind}`));
    const question = el("p", "question", q.question);
    question.id = `q${i}`;
    question.lang = lang;
    card.appendChild(question);
    if (q.quote && !HIDE_QUOTE.has(q.kind)) {
      const quote = el("p", "quote", q.quote);
      quote.lang = lang;
      card.appendChild(quote);
    }
    const options = el("div", "options");
    const buttons = q.options.map((text, idx) => {
      const b = el("button", "opt");
      b.type = "button";
      const answer = el("span", null, text);
      answer.lang = lang;
      b.append(el("span", "letter", LETTERS[idx]), answer);
      b.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "quizAnswer", id: quiz.id, index: i, choice: idx }).catch(() => {});
        reveal(idx);
      });
      options.appendChild(b);
      return b;
    });
    // Shows the result of a choice; also used to restore answers when the page is reopened.
    function reveal(idx) {
      const right = idx === q.correct_index;
      buttons.forEach((x, j) => {
        x.disabled = true;
        if (j === q.correct_index) x.classList.add("correct");
        else if (j === idx) x.classList.add("wrong");
        else x.classList.add("faded");
      });
      const exp = el("div", `exp ${right ? "ok" : "bad"}`);
      exp.append(el("strong", null, t(right ? "answerCorrect" : "answerWrong")), q.explanation);
      card.appendChild(exp);
      answered++;
      if (right) correct++;
      updateProgress();
    }
    card.appendChild(options);
    $("list").appendChild(card);
    if (quiz.answers?.[i] != null) reveal(quiz.answers[i]);
  });
  updateProgress();

  if (quiz.sourceTabId != null) {
    $("back").hidden = false;
    $("back").addEventListener("click", async () => {
      try {
        const tab = await chrome.tabs.update(quiz.sourceTabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch {
        $("backError").hidden = false;
      }
    });
  }
}

(async () => {
  localizePage();
  const { quizzes = [] } = await chrome.storage.local.get("quizzes");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    for (const button of document.querySelectorAll(".segtab")) {
      button.addEventListener("click", () => {
        tab = button.dataset.tab;
        showOverview(quizzes);
      });
    }
    showOverview(quizzes);
    return;
  }
  const quiz = quizzes.find((q) => q.id === id);
  if (quiz?.questions?.length) return showQuiz(quiz);
  $("detail").hidden = false;
  $("title").textContent = t("quizzesTitle");
  const empty = el("section", "card empty");
  empty.append(el("p", "muted", t("quizNotFound")));
  $("list").appendChild(empty);
  document.querySelector(".qlayout").classList.add("solo");
})();
