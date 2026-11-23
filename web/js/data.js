// Loads the word decks and lessons. data/index.json lists the languages that are ready, with counts;
// each language has data/<code>/words.tsv and, when its lessons are written, data/<code>/units.json.
const cache = new Map();

const fetchOk = async (url, as) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res[as]();
};

export const catalog = () => (cache.get("index") ?? cache.set("index", fetchOk("data/index.json", "json")).get("index"));

// Words, most frequent first: { word, head, level, pos, tr, en, rank }.
export function words(lang) {
  const key = `words:${lang}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      fetchOk(`data/${lang}/words.tsv`, "text").then((text) =>
        text
          .split("\n")
          .filter((line) => line && !line.startsWith("#"))
          .map((line, i) => {
            const [word, head, level, pos, tr, en] = line.split("\t");
            return { word, head: head || word, level, pos: pos || "", tr: tr || "", en: en || "", rank: i + 1 };
          })
      )
    );
    cache.get(key).catch(() => cache.delete(key)); // try again next time
  }
  return cache.get(key);
}

// Grammar units, or an empty list while a language has none yet.
export function units(lang) {
  const key = `units:${lang}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      catalog().then((index) => (index[lang]?.units ? fetchOk(`data/${lang}/units.json`, "json").then((d) => d.units) : []))
    );
    cache.get(key).catch(() => cache.delete(key));
  }
  return cache.get(key);
}
