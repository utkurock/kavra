// Activity helpers shared by the popup and the activity page: totals and streaks, a "listening
// waveform" of minutes per day, and monthly bars.
globalThis.KavraCharts ??= (() => {
  const { dayKey } = globalThis.Kavra;
  const EMPTY = { ms: 0, lines: 0, lookedUp: 0, quizzes: 0, correct: 0, wrong: 0 };
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

  // The last `count` days, oldest first.
  function lastDays(days, count) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: count }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (count - 1 - i));
      return { date, day: { ...EMPTY, ...days[dayKey(date)] } };
    });
  }

  // One bar per day, mirrored around a centre line like an audio waveform; height follows minutes.
  function waveform(container, days, { count, tooltip }) {
    const entries = lastDays(days, count);
    const max = Math.max(1, ...entries.map((e) => e.day.ms));
    container.replaceChildren(
      ...entries.map(({ date, day }, i) => {
        const bar = document.createElement("span");
        bar.className = "wave-bar";
        if (day.ms > 0) bar.style.setProperty("--h", (0.14 + (0.86 * day.ms) / max).toFixed(3));
        else bar.classList.add("empty");
        if (i === entries.length - 1) bar.classList.add("today");
        bar.style.setProperty("--i", i);
        bar.title = tooltip(date, day);
        return bar;
      })
    );
    return entries[0].date;
  }

  // One column per month for the last `months` months, with the minutes on top.
  function monthly(container, days, { months, locale, tooltip }) {
    const now = new Date();
    const totals = Array.from({ length: months }, (_, i) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
      return { date, ms: 0 };
    });
    for (const [key, day] of Object.entries(days)) {
      const [y, m] = key.split("-").map(Number);
      const slot = totals.find((s) => s.date.getFullYear() === y && s.date.getMonth() === m - 1);
      if (slot) slot.ms += day.ms || 0;
    }
    const max = Math.max(1, ...totals.map((s) => s.ms));
    container.replaceChildren(
      ...totals.map(({ date, ms }, i) => {
        const col = document.createElement("div");
        col.className = "month-col" + (ms ? "" : " empty") + (i === totals.length - 1 ? " current" : "");
        col.title = tooltip(date, ms);
        const value = Object.assign(document.createElement("span"), { className: "val", textContent: ms ? Math.round(ms / 60000) : "" });
        const bar = Object.assign(document.createElement("span"), { className: "bar" });
        bar.style.setProperty("--h", ms ? (0.06 + (0.94 * ms) / max).toFixed(3) : 0);
        bar.style.setProperty("--i", i);
        const label = Object.assign(document.createElement("span"), {
          className: "lbl",
          textContent: date.toLocaleDateString(locale, { month: "short" }),
        });
        col.append(value, bar, label);
        return col;
      })
    );
  }

  return { summarize, waveform, monthly };
})();
