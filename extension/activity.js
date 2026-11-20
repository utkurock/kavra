const { t, dayKey, localizePage } = globalThis.Kavra;
const { summarize, render } = globalThis.KavraHeatmap;
const $ = (id) => document.getElementById(id);
const ui = chrome.i18n.getUILanguage();
const minutes = (ms) => Math.round(ms / 60000);
const number = (n) => n.toLocaleString(ui);

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

  render($("heatmap"), activity, {
    weeks: 53,
    monthLocale: ui,
    tooltip: (date, day) =>
      t("dayTooltip", date.toLocaleDateString(ui, { day: "numeric", month: "short" }), minutes(day.ms), day.correct, day.wrong),
  });
  $("heatmap").ariaLabel = t("heatmapLabel", minutes(sum.ms), sum.activeDays);

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
    const minutesCell = cell("");
    minutesCell.append(bar);
    tr.append(
      cell(date.toLocaleDateString(ui, { weekday: "short", day: "numeric", month: "short" })),
      minutesCell,
      cell(number(day.lines || 0), "num"),
      cell(number(day.lookedUp || 0), "num"),
      cell(number(day.quizzes || 0), "num"),
      cell(number(day.correct || 0), "num ok"),
      cell(number(day.wrong || 0), "num bad")
    );
    body.append(tr);
  }
  $("empty").hidden = sum.activeDays > 0;
}

localizePage();
show();
// Stay current while captions run in another tab.
chrome.storage.onChanged.addListener((changes, area) => area === "local" && changes.activity && show());
