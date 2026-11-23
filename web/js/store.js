// What's kept in this browser: the chosen languages and levels, the theme, and progress per language
// learned. Storage may be blocked (private mode): then nothing is kept and the app still works.
const KEY = "kelime.v2";
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

const fresh = () => ({ onboarded: false, native: "tr", target: "en", levels: [...LEVELS], theme: "system", progress: {} });

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

// Before 2.0 the site only taught English to Turkish speakers and kept two records.
function migrate() {
  const v1 = read("kelime.v1");
  const lessons = read("kelime.sentences.v1");
  if (!v1 && !lessons) return null;
  const state = fresh();
  Object.assign(state, { onboarded: true, levels: v1?.levels?.length ? v1.levels : [...LEVELS] });
  state.progress.en = { deck: v1?.deck || {}, lessons: lessons || {} };
  return state;
}

export const state = { ...fresh(), ...(read(KEY) || migrate() || {}) };

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full or blocked
  }
}

// Progress for the language being learned: word states and mastered lesson items.
export function progress(lang = state.target) {
  state.progress[lang] ??= { deck: {}, lessons: {} };
  return state.progress[lang];
}
