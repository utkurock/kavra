const { t, localizePage } = globalThis.Lingo;
const $ = (id) => document.getElementById(id);
const KIND = { comprehension: "kindComprehension", vocabulary: "kindVocabulary", listening: "kindListening" };

(async () => {
  localizePage();
  const { quiz } = await chrome.storage.local.get("quiz");
  if (!quiz?.questions?.length) {
    $("meta").textContent = t("noQuiz");
    return;
  }
  const date = new Date(quiz.createdAt).toLocaleString(chrome.i18n.getUILanguage());
  $("meta").textContent = `${date} · ${t("questionCount", quiz.questions.length)}`;

  let answered = 0;
  let correct = 0;
  const total = quiz.questions.length;

  quiz.questions.forEach((q, i) => {
    const card = document.createElement("section");
    card.className = "q";
    const kind = document.createElement("div");
    kind.className = "kind";
    kind.textContent = `${i + 1}. ${KIND[q.kind] ? t(KIND[q.kind]) : q.kind}`;
    const question = document.createElement("div");
    question.className = "question";
    question.lang = quiz.lang || "";
    question.textContent = q.question;
    card.append(kind, question);
    if (q.quote && q.kind !== "listening") {
      const quote = document.createElement("p");
      quote.className = "quote";
      quote.lang = quiz.lang || "";
      quote.textContent = `“${q.quote}”`;
      card.appendChild(quote);
    }
    const buttons = q.options.map((opt, idx) => {
      const b = document.createElement("button");
      b.className = "opt";
      b.lang = quiz.lang || "";
      b.textContent = opt;
      b.addEventListener("click", () => {
        buttons.forEach((x) => (x.disabled = true));
        buttons[q.correct_index].classList.add("correct");
        if (idx === q.correct_index) correct++;
        else b.classList.add("wrong");
        const exp = document.createElement("p");
        exp.className = "exp";
        exp.textContent = q.explanation;
        card.appendChild(exp);
        answered++;
        $("score").textContent = t("score", correct, answered) + (answered === total ? ` · ${t("quizDone")}` : "");
      });
      card.appendChild(b);
      return b;
    });
    $("list").appendChild(card);
  });

  if (quiz.sourceTabId != null) {
    $("back").hidden = false;
    $("back").addEventListener("click", async () => {
      try {
        const tab = await chrome.tabs.update(quiz.sourceTabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch {
        $("score").textContent = t("videoTabClosed");
      }
    });
  }
})();
