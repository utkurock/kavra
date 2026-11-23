# Builds extension/core-words.txt: the most frequent English words (wordfreq), merged into dictionary
# base forms, without names, places, brands, abbreviations or vulgar words.
#   pip install wordfreq==3.1.1 simplemma==1.1.2
#   python3 tools/core-words.py > extension/core-words.txt   (macOS: needs /usr/share/dict/web2)
import re
from wordfreq import top_n_list, zipf_frequency
import simplemma

web2 = open('/usr/share/dict/web2').read().split('\n')
lower = {w for w in web2 if w and w.islower()}
# Common modern or British-spelled words the 1934 dictionary lacks.
EXTRA = set("""monday tuesday wednesday thursday friday saturday sunday january february march april may june july
august september october november december english american british christmas god internet email ok okay tv online
website mom dad gonna wanna gotta anymore favourite centre girlfriend boyfriend info kinda theatre neighbourhood
colour healthcare mini makeup honour behaviour organisation organization favour goodbye lifestyle mainstream realise
laptop anytime metro podcast timeline artwork teenager cafe neighbour euro burger cookie demo expertise smartphone
airline meantime pricing hype fridge mega congrats indie cyber gameplay harbour hardcore licence offence packaging
vegan vibe wifi workforce desktop soundtrack recognise catalog coordinator hometown meme arguably coordination
trafficking backyard grandparents grandparent blog download database cooperation classify congratulations
worldwide multi savings funding manufacturing broadcasting software hardware app website video weekend
online offline user password update upload feedback teen teenager guy guys okay ok sorry yeah hey wow
""".split())
BLOCK = set("""fuck fuckin fucking shit shitty bullshit asshole cunt goddamn porn bitch dick pussy cock whore slut
nigga nigger fag faggot retard damn ass crap piss bastard sexy""".split())
# Words that pass the dictionary check but are almost always names in the corpus.
NAMES = set("""jerry morris york smith peter tom jack mike joe mary henry martin harry lee ben boston sam tony bob kim nick michigan hong
dan jordan ford miller eric lewis alan jeff luke mac jimmy kelly morgan jane roger ross clark jay anna walter
ann carter josh rio billy rick graham larry las barry cooper ted warren khan carl laura nelson steven terry
barcelona parker perry bobby franklin ken phoenix amy wright cole turner jake kent benjamin blake tommy
collins costa kyle nancy vincent murphy pete ralph colin shaw spencer lucy bailey chile ruth montana harper
hart shanghai singh marc fisher palmer abu caroline travis blair geneva sanders wade florence drake finland
troy wang cox newton chad han kay betty honda joey marco randy seth gilbert griffin riley walt ana russia
china japan canada brazil batman superman twitter sierra guinea sri colorado berlin sal da mas san mot don chi
col ing ref pac tit cum anal boob penis sec bas con mar wee corp yea sept vol tho min pic gif rev sen gen ave
cant didnt doesnt wont isnt jean non sub semi neo inter multi mid micro ultra mega mini trump mason emma josh
lynch robin rex willie jenny homer beth burke maya molly brett yale manila pol mon""".split())
LIMIT = 5000
known = lambda w: w in lower or w in EXTRA

def stems(w):
    yield simplemma.lemmatize(w, lang='en').lower()
    for suf, rep in (('ies', 'y'), ('ied', 'y'), ('es', ''), ('s', ''), ('ed', 'e'), ('ed', ''), ('ing', 'e'), ('ing', ''),
                     ('er', ''), ('est', ''), ('ly', '')):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            s = w[: -len(suf)] + rep
            yield s
            if len(s) > 3 and s[-1] == s[-2] and not rep: yield s[:-1]  # stopped -> stop

def base(w):
    for s in stems(w):
        if re.fullmatch(r"[a-z]+", s) and s != w and known(s) and zipf_frequency(s, 'en') >= 3.2:
            # only fold -ly/-er/-est when the form isn't a common word of its own (really, never, best)
            return s
    return w

seen, out = set(), []
for w in top_n_list('en', 80000):
    if not re.fullmatch(r"[a-z]+(-[a-z]+)?", w): continue
    if len(w) == 1 and w not in ('a', 'i'): continue
    lemma = w if known(w) and zipf_frequency(w, 'en') >= 4.0 and w.endswith(('ly', 'er', 'est')) else base(w)
    if lemma in seen or lemma in BLOCK or lemma in NAMES: continue
    if not known(lemma) and lemma not in ('a', 'i'): continue
    if len(lemma) <= 2 and lemma not in EXTRA and lemma not in set("a i am an as at be by do go he if in is it me my no of oh on or so to up us we".split()): continue
    seen.add(lemma)
    out.append('I' if lemma == 'i' else lemma)
    if len(out) >= LIMIT: break
print('# The 5000 most frequent English words, most frequent first, one per line.')
print('# Built by tools/core-words.py from wordfreq (data CC BY-SA 4.0, https://github.com/rspeer/wordfreq).')
print('\n'.join(out))
