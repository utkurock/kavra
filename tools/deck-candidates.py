# Candidate words for the German, Spanish, French, Italian and Portuguese decks: the most frequent
# words (wordfreq) folded into their dictionary forms (simplemma), most frequent first. There's no
# dictionary here to drop names and stray forms, so it lists more than 5000; the people writing the
# meanings mark those to skip.
#   pip install wordfreq==3.1.1 simplemma==1.1.2
#   python3 tools/deck-candidates.py de [count] > candidates-de.txt
import re, sys
from wordfreq import top_n_list, zipf_frequency
import simplemma

lang = sys.argv[1]
WANT = int(sys.argv[2]) if len(sys.argv) > 2 else 5800
WORD = re.compile(r"[^\W\d_]+(-[^\W\d_]+)?")
seen, out = set(), []
for w in top_n_list(lang, 100000):
    if not WORD.fullmatch(w) or len(w) < 2 and w not in ("a", "à", "e", "é", "o", "y", "ó"):
        continue
    lemma = simplemma.lemmatize(w, lang=lang).lower()
    if not WORD.fullmatch(lemma) or zipf_frequency(lemma, lang) < 2.5:
        lemma = w
    if lemma in seen:
        continue
    seen.add(lemma)
    out.append(lemma)
    if len(out) >= WANT:
        break
print("\n".join(out))
