const { t, localizePage } = globalThis.Kavra;
const $ = (id) => document.getElementById(id);
const KIND = { comprehension: "kindComprehension", vocabulary: "kindVocabulary", listening: "kindListening" };
const LETTERS = "ABCDEFGH";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

(async () => {
  localizePage();
  const { quiz } = await chrome.storage.local.get("quiz");
  if (!quiz?.questions?.length) {
    const empty = el("section", "card empty");
    empty.append(el("p", "muted", t("noQuiz")));
    $("list").appendChild(empty);
    return;
  }
  const lang = quiz.lang || "";
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
    if (q.quote && q.kind !== "listening") {
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
      });
      options.appendChild(b);
      return b;
    });
    card.appendChild(options);
    $("list").appendChild(card);
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
})();
