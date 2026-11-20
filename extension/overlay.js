// Subtitle overlay in the captioned tab's top frame: the original line, a colour-matched translation
// line, and a translation card on click.
(() => {
  if (window.__kavraOverlay) return;
  window.__kavraOverlay = true;

  const { t, getSettings } = globalThis.Kavra;
  const MAX_FINAL_LINES = 2;
  const STRUGGLE_HOVER_MS = 800;
  const COLORS = ["#ffd54a", "#7fdbff", "#ff9eb5", "#a5e88f", "#ffb36b", "#c9a7ff"];

  const host = document.createElement("div");
  host.style.cssText = "all: initial; position: fixed; left: 0; width: 100%; bottom: 8%; z-index: 2147483647; pointer-events: none;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { display: flex; flex-direction: column; align-items: center; gap: 8px;
        font: 600 clamp(16px, 2.1vw, 30px)/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; }
      .box { max-width: 92%; display: flex; flex-direction: column; align-items: center; gap: 3px; }
      .line { pointer-events: auto; color: #fff; background: rgba(0,0,0,.74); padding: 2px 10px;
        border-radius: 6px; text-align: center; text-shadow: 0 1px 2px #000; }
      .orig { cursor: pointer; }
      .orig:hover, .orig:focus-visible { background: rgba(20,20,20,.92); outline: 2px solid #ffd54a; }
      .old { opacity: .6; font-size: .82em; }
      .interim { color: #ddd; font-style: italic; }
      .trans { font-weight: 500; font-size: .9em; color: #f2f2f2; transition: filter .15s; }
      .trans.blur { filter: blur(6px); cursor: help; }
      .trans.blur:hover, .trans.blur:focus-visible { filter: none; outline: none; }
      .trans.pending { color: #aaa; font-size: .7em; }
      .status { font-size: 13px; font-weight: 500; color: #fff; background: rgba(0,0,0,.6);
        padding: 2px 8px; border-radius: 4px; }
      .status.error { background: #b3261e; }
      .card { pointer-events: auto; max-width: min(92%, 760px); background: #1c1c20; color: #f2f2f2;
        border: 1px solid #3a3a40; border-radius: 10px; padding: 12px 16px 12px; position: relative;
        box-shadow: 0 6px 24px rgba(0,0,0,.5); font-size: 17px; font-weight: 500; line-height: 1.45; }
      .card .c-orig { margin-right: 26px; }
      .card .c-trans { font-size: 19px; font-weight: 700; margin-top: 6px; }
      .card ul { margin: 10px 0 0; padding-left: 18px; font-size: 14.5px; font-weight: 400; color: #d8d8dc; }
      .card li b { color: #fff; }
      .card .muted { color: #a8a8ae; font-size: 14px; }
      .card .err { color: #ff8a80; }
      .close { position: absolute; top: 4px; right: 6px; border: 0; background: none; font-size: 22px;
        cursor: pointer; color: #bbb; line-height: 1; padding: 4px 6px; }
      .close:focus-visible { outline: 2px solid #ffd54a; }
      [hidden] { display: none !important; }
    </style>
    <div class="wrap">
      <div class="card" hidden role="dialog"></div>
      <div class="status" hidden></div>
      <div class="box" aria-live="polite"></div>
    </div>`;

  const box = root.querySelector(".box");
  const card = root.querySelector(".card");
  const statusEl = root.querySelector(".status");
  card.ariaLabel = t("translation");

  const finals = []; // { text, result, pending, reported }
  let interim = "";
  let trMode = "blur";
  let locales = { orig: "en", trans: "en" }; // for case-insensitive matching
  let cardLine = null;
  let statusTimer;
  let errorShown = "";

  getSettings().then((s) => {
    trMode = s.trMode;
    locales = { orig: s.targetLang, trans: s.nativeLang };
    render();
  });

  // ---- colour matching: give each original chunk and its translated counterpart the same colour ----
  function findRange(text, phrase, locale, taken) {
    const needle = phrase.trim().replace(/^[\s.,!?;:"“”'’-]+|[\s.,!?;:"“”'’-]+$/g, "");
    if (!needle) return null;
    const lower = text.toLocaleLowerCase(locale);
    const caseless = lower.length === text.length;
    const hay = caseless ? lower : text;
    const pin = caseless ? needle.toLocaleLowerCase(locale) : needle;
    for (let from = hay.indexOf(pin); from !== -1; from = hay.indexOf(pin, from + 1)) {
      const r = [from, from + pin.length];
      if (!taken.some(([a, b]) => a < r[1] && r[0] < b)) return r;
    }
    return null;
  }

  function colourSpans(result, text) {
    const orig = [];
    const trans = [];
    for (const pair of result.pairs || []) {
      const o = findRange(text, pair.original, locales.orig, orig.map((s) => s.range));
      const tr = findRange(result.translation, pair.translated, locales.trans, trans.map((s) => s.range));
      if (!o || !tr) continue; // colour only pairs found on both sides
      const color = COLORS[orig.length % COLORS.length];
      orig.push({ range: o, color });
      trans.push({ range: tr, color });
    }
    return { orig, trans };
  }

  function paint(el, text, spans = []) {
    el.replaceChildren();
    let pos = 0;
    for (const { range: [a, b], color } of [...spans].sort((x, y) => x.range[0] - y.range[0])) {
      if (a > pos) el.append(text.slice(pos, a));
      const s = document.createElement("span");
      s.style.color = color;
      s.textContent = text.slice(a, b);
      el.append(s);
      pos = b;
    }
    el.append(text.slice(pos));
    return el;
  }

  // ---- rendering ----
  function attach() {
    // Fullscreen hides everything outside the fullscreen element, so move the overlay inside it.
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== "VIDEO" && fs.tagName !== "IFRAME" ? fs : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
    place();
  }

  // The biggest visible player on the page: a <video>, or the iframe a site embeds its player in.
  function playerRect() {
    let best = null;
    for (const el of document.querySelectorAll("video, iframe")) {
      const r = el.getBoundingClientRect();
      if (r.width < 240 || r.height < 135 || r.bottom <= 0 || r.top >= innerHeight) continue;
      const score = r.width * r.height * (el.tagName === "VIDEO" ? 2 : 1); // real videos win over iframes
      if (!best || score > best.score) best = { r, score };
    }
    return best?.r;
  }

  // Sit inside the player, above its control bar; fall back to the bottom of the window.
  function place() {
    const r = document.fullscreenElement ? null : playerRect();
    if (!r) {
      Object.assign(host.style, { left: "0px", width: "100%", bottom: "8%" });
      return;
    }
    const left = Math.max(r.left, 0);
    const right = Math.min(r.right, innerWidth);
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, innerHeight);
    Object.assign(host.style, {
      left: `${left}px`,
      width: `${right - left}px`,
      bottom: `${innerHeight - bottom + (bottom - top) * 0.15}px`,
    });
  }
  const placeTimer = setInterval(place, 400); // players move and resize without telling anyone

  function div(className, text) {
    const el = document.createElement("div");
    el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function render() {
    box.replaceChildren();
    finals.forEach((line, i) => {
      const latest = i === finals.length - 1;
      const spans = line.result ? colourSpans(line.result, line.text) : null;
      const orig = paint(div("line orig" + (latest ? "" : " old")), line.text, spans?.orig);
      orig.tabIndex = 0;
      orig.title = t("clickHint");
      orig.addEventListener("click", () => openCard(line));
      orig.addEventListener("keydown", (e) => e.key === "Enter" && openCard(line));
      box.appendChild(orig);

      if (!latest || trMode === "click") return;
      if (line.result) {
        const trans = paint(div("line trans" + (trMode === "blur" ? " blur" : "")), line.result.translation, spans.trans);
        if (trMode === "blur") watchStruggle(trans, line);
        box.appendChild(trans);
      } else if (line.pending) {
        box.appendChild(div("line trans pending", t("translating")));
      }
    });
    if (interim) box.appendChild(div("line interim", interim));
  }

  // Revealing a blurred line for a moment counts as "needed help" for the quiz.
  function watchStruggle(el, line) {
    el.tabIndex = 0;
    el.title = t("hoverHint");
    let timer;
    const start = () => {
      if (line.reported) return;
      timer = setTimeout(() => {
        line.reported = true;
        chrome.runtime.sendMessage({ type: "struggled", text: line.text }).catch(() => {});
      }, STRUGGLE_HOVER_MS);
    };
    const cancel = () => clearTimeout(timer);
    el.addEventListener("mouseenter", start);
    el.addEventListener("focus", start);
    el.addEventListener("mouseleave", cancel);
    el.addEventListener("blur", cancel);
  }

  function showStatus(text, error = false) {
    clearTimeout(statusTimer);
    statusEl.textContent = text;
    statusEl.classList.toggle("error", error);
    statusEl.hidden = false;
    statusTimer = setTimeout(() => (statusEl.hidden = true), error ? 8000 : 4000);
  }

  // ---- translation ----
  async function requestTranslation(line, live) {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "translate", text: line.text, live });
    } catch {
      res = { ok: false, error: t("extensionReloaded") };
    }
    line.pending = false;
    if (res?.ok) {
      line.result = res;
      errorShown = "";
    } else {
      line.error = res?.error || t("translationFailed");
      if (live && line.error !== errorShown) showStatus((errorShown = line.error), true);
    }
    render();
    if (cardLine === line) fillCard();
  }

  // ---- card ----
  function media(action) {
    chrome.runtime.sendMessage({ type: "media", action }).catch(() => {});
  }

  function openCard(line) {
    if (!cardLine) media("pause");
    cardLine = line;
    if (!line.result) {
      line.pending = true;
      line.error = null;
    }
    fillCard();
    card.hidden = false;
    // A click always asks the background too, so the line is remembered for the quiz.
    requestTranslation(line, false);
  }

  function closeCard() {
    if (!cardLine) return;
    cardLine = null;
    card.hidden = true;
    media("resume");
  }

  function fillCard() {
    const line = cardLine;
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "×";
    close.ariaLabel = t("closeAndContinue");
    close.addEventListener("click", closeCard);
    card.replaceChildren(close);

    const spans = line.result ? colourSpans(line.result, line.text) : null;
    card.appendChild(paint(div("c-orig"), line.text, spans?.orig));
    if (line.result) {
      card.appendChild(paint(div("c-trans"), line.result.translation, spans.trans));
      if (line.result.notes?.length) {
        const ul = document.createElement("ul");
        for (const n of line.result.notes) {
          const li = document.createElement("li");
          const b = document.createElement("b");
          b.textContent = n.phrase;
          li.append(b, ` — ${n.meaning}`);
          ul.appendChild(li);
        }
        card.appendChild(ul);
      }
    } else if (line.error && !line.pending) {
      card.appendChild(div("err", line.error));
    } else {
      card.appendChild(div("muted", t("translating")));
    }
  }

  // ---- messages ----
  function onCaption(text, final) {
    if (!final) {
      interim = text;
    } else {
      const line = { text, result: null, pending: trMode !== "click" };
      finals.push(line);
      if (finals.length > MAX_FINAL_LINES) finals.shift();
      interim = "";
      if (line.pending) requestTranslation(line, true);
    }
    attach();
    render();
  }

  function teardown(message) {
    chrome.runtime.onMessage.removeListener(onMessage);
    chrome.storage.onChanged.removeListener(onStorage);
    document.removeEventListener("fullscreenchange", attach);
    removeEventListener("resize", place);
    clearInterval(placeTimer);
    document.removeEventListener("keydown", onKeydown);
    window.__kavraOverlay = false;
    closeCard();
    finals.length = 0;
    interim = "";
    render();
    if (message) {
      showStatus(message, true);
      setTimeout(() => host.remove(), 8000);
    } else {
      host.remove();
    }
  }

  function onMessage(msg) {
    if (msg.type === "caption") onCaption(msg.text, msg.final);
    else if (msg.type === "status") showStatus(msg.text, msg.error);
    else if (msg.type === "stop") teardown(msg.message);
  }

  function onStorage(changes, area) {
    if (area !== "local") return;
    if (changes.targetLang || changes.nativeLang) {
      // Lines on screen belong to the old language pair.
      locales = { orig: changes.targetLang?.newValue || locales.orig, trans: changes.nativeLang?.newValue || locales.trans };
      closeCard();
      finals.length = 0;
      interim = "";
      render();
    }
    if (!changes.trMode) return;
    trMode = changes.trMode.newValue || "blur";
    // Lines shown while in click mode have no translation yet.
    const latest = finals.at(-1);
    if (trMode !== "click" && latest && !latest.result && !latest.pending) {
      latest.pending = true;
      requestTranslation(latest, true);
    }
    render();
  }

  function onKeydown(e) {
    if (e.key === "Escape") closeCard();
  }

  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorage);
  document.addEventListener("fullscreenchange", attach);
  addEventListener("resize", place);
  document.addEventListener("keydown", onKeydown);
  attach();
})();
