// Daily activity helpers shared by the popup and the activity page: totals, streaks and a
// GitHub-style heatmap of minutes watched per day.
globalThis.KavraHeatmap ??= (() => {
  const { dayKey } = globalThis.Kavra;
  const EMPTY = { ms: 0, lines: 0, lookedUp: 0, quizzes: 0, correct: 0, wrong: 0 };

  // 0 = nothing, then under 10, 20, 40 and 40+ minutes.
  function level(ms) {
    const min = ms / 60000;
    return min <= 0 ? 0 : min < 10 ? 1 : min < 20 ? 2 : min < 40 ? 3 : 4;
  }

  const active = (day) => Boolean(day && (day.ms > 0 || day.lines > 0));

  function summarize(days) {
    const total = { ...EMPTY };
    for (const day of Object.values(days)) for (const k of Object.keys(EMPTY)) total[k] += day[k] || 0;
    // Streak: consecutive active days ending today, or yesterday if nothing happened yet today.
    const date = new Date();
    if (!active(days[dayKey(date)])) date.setDate(date.getDate() - 1);
    let streak = 0;
    while (active(days[dayKey(date)])) {
      streak++;
      date.setDate(date.getDate() - 1);
    }
    const answered = total.correct + total.wrong;
    return {
      ...total,
      today: { ...EMPTY, ...days[dayKey()] },
      streak,
      activeDays: Object.values(days).filter(active).length,
      accuracy: answered ? Math.round((total.correct / answered) * 100) : null,
    };
  }

  // Columns are weeks (Monday first), the last one holds today.
  function render(container, days, { weeks, tooltip, monthLocale }) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7);

    const months = document.createElement("div");
    months.className = "hm-months";
    const grid = document.createElement("div");
    grid.className = "hm-grid";
    container.style.setProperty("--weeks", weeks);

    let lastMonth = -1;
    let lastLabel = null;
    for (let w = 0; w < weeks; w++) {
      const weekStart = new Date(start);
      weekStart.setDate(start.getDate() + w * 7);
      if (weekStart.getMonth() !== lastMonth && w < weeks - 2) {
        lastMonth = weekStart.getMonth();
        // A month that only got a week or two before the next one would collide with its label.
        if (lastLabel && w - lastLabel.week < 3) lastLabel.el.remove();
        const el = document.createElement("span");
        el.style.gridColumn = String(w + 1);
        el.textContent = weekStart.toLocaleDateString(monthLocale, { month: "short" });
        months.append(el);
        lastLabel = { el, week: w };
      }
      for (let d = 0; d < 7; d++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + d);
        const cell = document.createElement("span");
        cell.className = "hm-cell";
        if (date > today) {
          cell.classList.add("future");
        } else {
          const day = days[dayKey(date)];
          cell.dataset.level = level(day?.ms || 0);
          cell.title = tooltip(date, { ...EMPTY, ...day });
        }
        grid.append(cell);
      }
    }
    container.replaceChildren(months, grid);
  }

  return { level, summarize, render };
})();
