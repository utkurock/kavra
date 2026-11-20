// Subtitle overlay: the original line, a colour-matched translation line, and a translation card on
// click. It's injected into every frame of the captioned tab; the top frame shows it, except while an
// embedded player's frame is fullscreen, when that frame's copy takes over (nothing else is drawn then).
(() => {
  if (window.__kavraOverlay) return;
  window.__kavraOverlay = true;

  const { t, getSettings } = globalThis.Kavra;
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
      .line { touch-action: none; }
      .orig { cursor: pointer; }
      .box.dragging .line { cursor: grabbing; }
      .orig:hover, .orig:focus-visible { background: rgba(20,20,20,.92); outline: 2px solid #ffd54a; }
      .old { opacity: .6; font-size: .82em; }
      .trans { font-weight: 500; font-size: .9em; color: #f2f2f2; transition: filter .15s; }
      .trans.blur { filter: blur(6px); cursor: help; }
      .trans.blur:hover, .trans.blur:focus-visible { filter: none; outline: none; }
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

  let line = null; // the line on screen: { text, result, pending, reported, error }
  let anchor = "bottom"; // "top" while the site's own subtitles stay on screen (speech recognition)
  let customPos = null; // where the user dragged the subtitles: 0 (top) to 1 (bottom) of the player
  const isTop = window === window.top;
  let trMode = "blur";
  let locales = { orig: "en", trans: "en" }; // for case-insensitive matching
  let cardLine = null;
  let statusTimer;
  let errorShown = "";

  getSettings().then(async (s) => {
    trMode = s.trMode;
    locales = { orig: s.targetLang, trans: s.nativeLang };
    customPos = (await chrome.storage.local.get("overlayPos")).overlayPos ?? null;
    render();
    place();
  });

  function displaying() {
    const fs = document.fullscreenElement;
    return isTop ? !(fs && fs.tagName === "IFRAME") : Boolean(fs);
  }

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
    host.style.display = displaying() ? "block" : "none";
    if (line && displaying()) translateIfVisible(line);
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

  // The visible part of the player, or the whole window in fullscreen or when there's no player.
  function playerArea() {
    const r = document.fullscreenElement ? null : playerRect();
    if (!r) return { left: 0, right: innerWidth, top: 0, bottom: innerHeight, inPlayer: false };
    return {
      left: Math.max(r.left, 0),
      right: Math.min(r.right, innerWidth),
      top: Math.max(r.top, 0),
      bottom: Math.min(r.bottom, innerHeight),
      inPlayer: true,
    };
  }

  // Where the user dragged it, or automatically: above the player's control bar when Kavra shows the
  // site's subtitles in their place, near its top when the site's own subtitles stay at the bottom.
  function place() {
    const { left, right, top, bottom, inPlayer } = playerArea();
    const height = bottom - top;
    Object.assign(host.style, { left: `${left}px`, width: `${right - left}px` });
    let upper;
    if (customPos != null) {
      Object.assign(host.style, { top: `${top + height * customPos - host.offsetHeight / 2}px`, bottom: "auto" });
      upper = customPos < 0.5;
    } else if (anchor === "top") {
      Object.assign(host.style, { top: `${top + height * (inPlayer ? 0.07 : 0.06)}px`, bottom: "auto" });
      upper = true;
    } else {
      Object.assign(host.style, { top: "auto", bottom: `${innerHeight - bottom + height * (inPlayer ? 0.15 : 0.08)}px` });
      upper = false;
    }
    // Keep the translation card on the side away from the nearest edge.
    root.querySelector(".wrap").style.flexDirection = upper ? "column-reverse" : "column";
  }

  // ---- drag the subtitles up or down; a press without movement is still a click ----
  // The pointer leaves the line as soon as it moves, so movement is followed on the whole window.
  let drag = null;
  let suppressClick = false;
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientY - drag.y) < 5) return;
      drag.moved = true;
      box.classList.add("dragging");
    }
    e.preventDefault();
    const { top, bottom } = playerArea();
    customPos = Math.min(0.95, Math.max(0.05, (e.clientY - top) / (bottom - top)));
    place();
  }
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    removeEventListener("pointermove", onDragMove, true);
    removeEventListener("pointerup", endDrag, true);
    removeEventListener("pointercancel", endDrag, true);
    if (drag.moved) {
      // The click that follows the release must not open the translation card.
      suppressClick = true;
      setTimeout(() => (suppressClick = false));
      box.classList.remove("dragging");
      chrome.storage.local.set({ overlayPos: customPos });
    }
    drag = null;
  }
  box.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.target.closest(".line")) return;
    drag = { y: e.clientY, id: e.pointerId, moved: false };
    addEventListener("pointermove", onDragMove, true);
    addEventListener("pointerup", endDrag, true);
    addEventListener("pointercancel", endDrag, true);
  });
  const placeTimer = setInterval(place, 400); // players move and resize without telling anyone

  function div(className, text) {
    const el = document.createElement("div");
    el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  // Only the current line and, once it's ready, its translation: no half-heard text, no placeholders.
  function render() {
    box.replaceChildren();
    if (!line) return;
    const shown = line;
    const spans = shown.result ? colourSpans(shown.result, shown.text) : null;
    const orig = paint(div("line orig"), shown.text, spans?.orig);
    orig.tabIndex = 0;
    orig.title = t("clickHint");
    orig.addEventListener("click", () => !suppressClick && openCard(shown));
    orig.addEventListener("keydown", (e) => e.key === "Enter" && openCard(shown));
    box.appendChild(orig);
    if (trMode === "click" || !shown.result) return;
    const trans = paint(div("line trans" + (trMode === "blur" ? " blur" : "")), shown.result.translation, spans.trans);
    if (trMode === "blur") watchStruggle(trans, shown);
    box.appendChild(trans);
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
  async function requestTranslation(target, live) {
    const line = target;
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

  function openCard(target) {
    if (!cardLine) media("pause");
    cardLine = target;
    if (!target.result) {
      target.pending = true;
      target.error = null;
    }
    fillCard();
    card.hidden = false;
    // Live translations skip the notes, so a click asks for the full version (and the line is
    // remembered for the quiz).
    requestTranslation(target, false);
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
  // Live translations only while the tab is in view, so a video playing in the background costs nothing.
  function translateIfVisible(target) {
    if (trMode === "click" || !displaying() || document.visibilityState !== "visible") return;
    if (target.result || target.pending) return;
    target.pending = true;
    requestTranslation(target, true);
  }

  function onCaption(text, source) {
    anchor = source === "page" ? "bottom" : "top";
    line = { text, result: null, pending: false };
    translateIfVisible(line);
    attach();
    render();
  }

  function onVisibility() {
    if (line) translateIfVisible(line);
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
    line = null;
    render();
    document.removeEventListener("visibilitychange", onVisibility);
    if (message) {
      showStatus(message, true);
      setTimeout(() => host.remove(), 8000);
    } else {
      host.remove();
    }
  }

  function onMessage(msg) {
    if (msg.type === "caption") onCaption(msg.text, msg.source);
    else if (msg.type === "status") showStatus(msg.text, msg.error);
    else if (msg.type === "stop") teardown(msg.message);
  }

  function onStorage(changes, area) {
    if (area !== "local") return;
    if (changes.targetLang || changes.nativeLang) {
      // Lines on screen belong to the old language pair.
      locales = { orig: changes.targetLang?.newValue || locales.orig, trans: changes.nativeLang?.newValue || locales.trans };
      closeCard();
      line = null;
      render();
    }
    if ("overlayPos" in changes) {
      customPos = changes.overlayPos.newValue ?? null;
      place();
    }
    if (!changes.trMode) return;
    trMode = changes.trMode.newValue || "blur";
    // A line shown while in click mode has no translation yet.
    if (line) translateIfVisible(line);
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
  document.addEventListener("visibilitychange", onVisibility);
  attach();
})();
