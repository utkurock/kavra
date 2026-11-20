const { t, dayKey, localizePage } = globalThis.Kavra;
const { summarize, waveform, monthly } = globalThis.KavraCharts;
const $ = (id) => document.getElementById(id);
const ui = chrome.i18n.getUILanguage();
const minutes = (ms) => Math.round(ms / 60000);
const number = (n) => n.toLocaleString(ui);

// A number column; zeros are dimmed so the days with something in them stand out.
const count = (n = 0, tone = "") => cell(number(n), `num ${n ? tone : "zero"}`);

function cell(text, className) {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

async function show() {
  const { activity = {} } = await chrome.storage.local.get("activity");
  const sum = summarize(activity);
  $("sumMinutes").textContent = number(minutes(sum.ms));
  $("sumDays").textContent = number(sum.activeDays);
  $("sumStreak").textContent = number(sum.streak);
  $("sumLines").textContent = number(sum.lines);
  $("sumLookedUp").textContent = number(sum.lookedUp);
  $("sumAccuracy").textContent = sum.accuracy == null ? "–" : `${sum.accuracy}%`;
  $("sumAnswers").textContent = t("correctWrong", sum.correct, sum.wrong);

  const start = waveform($("wave"), activity, {
    count: 90,
    tooltip: (date, day) =>
      t("dayTooltip", date.toLocaleDateString(ui, { day: "numeric", month: "short" }), minutes(day.ms), day.correct, day.wrong),
  });
  $("waveStart").textContent = start.toLocaleDateString(ui, { day: "numeric", month: "short" });
  $("wave").ariaLabel = t("activityLabel", minutes(sum.ms), sum.activeDays);
  monthly($("months"), activity, {
    months: 12,
    locale: ui,
    tooltip: (date, ms) => t("monthTooltip", date.toLocaleDateString(ui, { month: "long", year: "numeric" }), minutes(ms)),
  });
  $("months").ariaLabel = t("lastYear");

  // Last 14 days, newest first, with a bar scaled to the busiest day.
  const rows = [];
  for (let i = 0; i < 14; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    rows.push([date, activity[dayKey(date)]]);
  }
  const maxMs = Math.max(1, ...rows.map(([, day]) => day?.ms || 0));
  const body = $("days");
  body.replaceChildren();
  for (const [date, day = {}] of rows) {
    const tr = document.createElement("tr");
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.round(((day.ms || 0) / maxMs) * 120)}px`;
    fill.hidden = !day.ms;
    bar.append(fill, number(minutes(day.ms || 0)));
    const minutesCell = cell("", day.ms ? "" : "zero");
    minutesCell.append(bar);
    tr.append(
      cell(date.toLocaleDateString(ui, { weekday: "short", day: "numeric", month: "short" })),
      minutesCell,
      count(day.lines),
      count(day.lookedUp),
      count(day.quizzes),
      count(day.correct, "ok"),
      count(day.wrong, "bad")
    );
    body.append(tr);
  }
  $("empty").hidden = sum.activeDays > 0;

  // Today's panel.
  const today = sum.today;
  $("todayMinutes").textContent = number(minutes(today.ms));
  for (const [id, n] of [["todayLines", today.lines], ["todayLookedUp", today.lookedUp], ["todayQuizzes", today.quizzes],
    ["todayCorrect", today.correct], ["todayWrong", today.wrong]]) {
    $(id).textContent = number(n);
    $(id).classList.toggle("zero", !n);
  }
}

// The latest lines saved to the word pool.
async function showRecent() {
  const { words = [] } = await chrome.storage.local.get("words");
  $("recent").replaceChildren(
    ...words.slice(0, 5).map((w) => {
      const li = document.createElement("li");
      const orig = Object.assign(document.createElement("div"), { className: "r-orig", textContent: w.text, title: w.text });
      const trans = Object.assign(document.createElement("div"), { className: "r-trans", textContent: w.translation });
      li.append(orig, trans);
      return li;
    })
  );
  $("recentEmpty").hidden = words.length > 0;
}

localizePage();
show();
showRecent();
// Stay current while captions run in another tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.activity) show();
  if (changes.words) showRecent();
});
