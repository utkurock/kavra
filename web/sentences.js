// Sentences: grammar units (A1–B2) with two kinds of exercise. "build" gives a Turkish sentence and
// shuffled English word tiles to put in order; "choice" gives an English sentence with a gap and a few
// words to fill it. A lesson takes up to 10 items of a unit, the ones not yet mastered first; a wrong
// answer comes back at the end of the lesson. Items answered right the first time count as mastered.
// Uses speak() from app.js, which loads after this file.
window.Sentences = (() => {
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = "kelime.sentences.v1";
  const LESSON_SIZE = 10;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const levelClass = (level) => level[0].toLowerCase();
  const shuffle = (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // Words as tiles: punctuation off, case kept.
  const tiles = (sentence) => sentence.replace(/[.?!,]/g, "").split(/\s+/).filter(Boolean);
  const same = (a, b) => tiles(a).join(" ").toLowerCase() === tiles(b).join(" ").toLowerCase();

  let units = null; // loaded on first visit
  let shownLevels = new Set();
  let mastered = {}; // unit id -> item indexes answered right the first time
  try {
    mastered = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
  } catch {
    // blocked storage: nothing is kept
  }
  const save = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(mastered));
    } catch {
      // storage full or blocked
    }
  };

  // ---- unit list ----
  async function showUnits(levels) {
    shownLevels = levels;
    const root = $("units");
    if (!units) {
      root.replaceChildren(el("p", "none", "Yükleniyor…"));
      try {
        units = (await (await fetch("sentences.json")).json()).units;
      } catch {
        root.replaceChildren(el("p", "none", "Dersler yüklenemedi. Sayfayı yenile."));
        return;
      }
    }
    const shown = units.filter((u) => levels.has(u.level));
    if (!shown.length) return root.replaceChildren(el("p", "none", "Seçtiğin seviyelerde ders yok. Yukarıdan A1–B2 arasından seç."));
    root.replaceChildren(
      ...shown.map((unit) => {
        const done = (mastered[unit.id] || []).length;
        const card = el("button", "unit");
        card.type = "button";
        const head = el("div", "unit-head");
        head.append(el("span", `badge ${levelClass(unit.level)}`, unit.level), el("span", "unit-count", `${done}/${unit.items.length}`));
        const bar = el("div", "ubar");
        const fill = el("span");
        fill.style.width = `${(done / unit.items.length) * 100}%`;
        bar.append(fill);
        card.append(head, el("span", "unit-title", unit.title), el("span", "unit-tip", unit.tip), bar);
        card.addEventListener("click", () => startLesson(unit));
        return card;
      })
    );
  }

  // ---- a lesson ----
  let lesson = null; // { unit, queue, total, right, firstTry, missed }
  let answer = null; // returns the learner's answer, or null while there isn't one
  let checked = false;

  function startLesson(unit) {
    const done = new Set(mastered[unit.id] || []);
    const order = shuffle(unit.items.map((_, i) => i));
    const pick = [...order.filter((i) => !done.has(i)), ...order.filter((i) => done.has(i))].slice(0, LESSON_SIZE);
    lesson = { unit, queue: pick, total: pick.length, right: 0, firstTry: 0, missed: new Set() };
    document.body.classList.add("in-lesson");
    $("lesson").hidden = false;
    next();
  }

  function endLesson() {
    lesson = null;
    document.body.classList.remove("in-lesson");
    $("lesson").hidden = true;
    window.speechSynthesis?.cancel();
    showUnits(shownLevels);
  }

  function setProgress() {
    const pct = Math.round((lesson.right / lesson.total) * 100);
    $("lesson").querySelector(".lbar span").style.width = `${pct}%`;
    $("lesson").querySelector(".lbar").ariaValueNow = pct;
  }

  function next() {
    checked = false;
    setProgress();
    const sheet = $("sheet");
    sheet.className = "sheet";
    sheet.querySelector(".verdict").replaceChildren();
    $("check").textContent = "Kontrol et";
    if (!lesson.queue.length) return showSummary();
    const item = lesson.unit.items[lesson.queue[0]];
    $("check").disabled = true;
    $("exercise").replaceChildren(...(item.type === "build" ? buildView(item) : choiceView(item))); // sets answer
  }

  // Tiles move from the bank to the answer line and back; a used tile leaves its place in the bank.
  function buildView(item) {
    const prompt = el("p", "prompt", item.tr);
    const line = el("div", "answer-line");
    const bank = el("div", "bank");
    const chosen = [];
    // The first word in lower case, so its capital doesn't give it away (not "I" or a name like "Ali").
    const own = tiles(item.en);
    if (own[0] !== "I" && !item.tr.includes(own[0])) own[0] = own[0][0].toLowerCase() + own[0].slice(1);
    const words = shuffle([...own, ...(item.extra || [])]);
    for (const word of words) {
      const slot = el("span", "slot");
      const tile = el("button", "tile", word);
      tile.type = "button";
      tile.lang = "en";
      tile.addEventListener("click", () => {
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
      });
      slot.append(tile);
      bank.append(slot);
    }
    answer = () => (chosen.length ? chosen.map((t) => t.textContent).join(" ") : null);
    return [el("h2", "ask", "Bu cümleyi İngilizce kur"), prompt, line, bank];
  }

  function choiceView(item) {
    const sentence = el("p", "gap-sentence");
    sentence.lang = "en";
    const [before, after] = item.en.split("___");
    const gap = el("span", "gap", " ");
    sentence.append(before, gap, after);
    const options = el("div", "options");
    let picked = null;
    item.options.forEach((text, i) => {
      const option = el("button", "option", text);
      option.type = "button";
      option.lang = "en";
      option.addEventListener("click", () => {
        if (checked) return;
        picked = i;
        for (const o of options.children) o.ariaPressed = String(o === option);
        gap.textContent = text;
        gap.classList.add("filled");
        $("check").disabled = false;
      });
      options.append(option);
    });
    answer = () => picked;
    return [el("h2", "ask", "Boşluğu doldur"), sentence, el("p", "meaning-tr", item.tr), options];
  }

  function check() {
    const index = lesson.queue[0];
    const item = lesson.unit.items[index];
    const given = answer?.();
    if (given == null) return;
    const right = item.type === "build" ? [item.en, ...(item.alt || [])].some((s) => same(s, given)) : given === item.answer;
    const full = item.type === "build" ? item.en : item.en.replace("___", item.options[item.answer]);
    checked = true;
    lesson.queue.shift();
    const done = new Set(mastered[lesson.unit.id] || []);
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
    mastered[lesson.unit.id] = [...done];
    save();
    setProgress();
    // The verdict, the full sentence to hear, and the way on.
    const sheet = $("sheet");
    sheet.className = `sheet ${right ? "ok" : "bad"}`;
    const verdict = sheet.querySelector(".verdict");
    const title = el("strong", null, right ? "Doğru!" : "Doğru cevap:");
    const sentence = el("span", "full", full);
    sentence.lang = "en";
    const listen = el("button", "icon-btn listen");
    listen.type = "button";
    listen.ariaLabel = "Dinle";
    listen.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
    listen.addEventListener("click", () => speak(full));
    verdict.replaceChildren(title, sentence, listen);
    $("check").textContent = "Devam";
    $("check").disabled = false;
    navigator.vibrate?.(right ? 8 : [12, 60, 12]);
    speak(full);
  }

  function showSummary() {
    const accuracy = Math.round((lesson.firstTry / lesson.total) * 100);
    const box = el("div", "summary");
    const again = el("button", "secondary", "Yeniden çalış");
    again.type = "button";
    const unit = lesson.unit;
    again.addEventListener("click", () => startLesson(unit));
    box.append(
      el("span", "big", `%${accuracy}`),
      el("p", null, accuracy >= 80 ? "Harika gidiyorsun!" : accuracy >= 50 ? "İyi, biraz daha pratik." : "Bu üniteyi bir tur daha çalış."),
      el("p", "muted", `${lesson.total} sorudan ${lesson.firstTry} tanesini ilk denemede bildin.`),
      again
    );
    $("exercise").replaceChildren(box);
    $("sheet").className = "sheet";
    $("sheet").querySelector(".verdict").replaceChildren();
    $("check").textContent = "Ünitelere dön";
    $("check").disabled = false;
    checked = "done";
  }

  $("check").addEventListener("click", () => {
    if (checked === "done") endLesson();
    else if (checked) next();
    else check();
  });
  $("quit").addEventListener("click", endLesson);
  document.addEventListener("keydown", (e) => {
    if (!lesson || e.key !== "Enter" || $("check").disabled) return;
    e.preventDefault();
    $("check").click();
  });

  return { showUnits };
})();
