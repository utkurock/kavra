// Subtitle overlay: the original line, a colour-matched translation line, and a translation card on
// click. It's injected into every frame of the captioned tab; the top frame shows it, except while an
// embedded player's frame is fullscreen, when that frame's copy takes over (nothing else is drawn then).
(() => {
  // A copy left from before the extension was reloaded can't reach the extension any more, so a new
  // injection replaces it instead of stepping aside.
  if (window.__kavraOverlay?.alive?.()) return;
  window.__kavraOverlay = { alive: () => Boolean(chrome.runtime?.id) };

  const { t, getSettings } = globalThis.Kavra;
  const STRUGGLE_HOVER_MS = 800;
  const HISTORY_SIZE = 5;
  const COLORS = ["#ffd54a", "#7fdbff", "#ff9eb5", "#a5e88f", "#ffb36b", "#c9a7ff"];

  const host = document.createElement("div");
  host.style.cssText = "all: initial; position: fixed; left: 0; width: 100%; bottom: 8%; z-index: 2147483647; pointer-events: none;";
  host.dataset.kavraOverlay = "";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      /* Text scales with the player's width (the host is as wide as the player), not the window. */
      .frame { container-type: inline-size; width: 100%; }
      .wrap { display: flex; flex-direction: column; align-items: center; gap: 8px;
        font: 600 calc(clamp(13px, 2.3cqi, 24px) * var(--scale, 1))/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; }
      .lines { position: relative; max-width: 92%; }
      .box { display: flex; flex-direction: column; align-items: center; gap: 3px; }
      .line { pointer-events: auto; color: #fff; background: rgba(0,0,0,.74); padding: 2px 10px;
        border-radius: 6px; text-align: center; text-shadow: 0 1px 2px #000; }
      .line { touch-action: none; }
      .orig { cursor: pointer; }
      .box.dragging .line { cursor: grabbing; }
      .orig:hover, .orig:focus-visible { background: rgba(20,20,20,.92); outline: 2px solid #ffd54a; }
      .old { opacity: .62; font-size: .82em; }
      .trans { font-weight: 500; font-size: .9em; color: #f2f2f2; transition: filter .15s; }
      .trans.blur { filter: blur(6px); cursor: help; }
      .trans:focus-visible { outline: none; }
      .trans.for-old { font-size: .82em; }
      .trans.wait { color: #a8a8ae; }
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
      /* line history: a button at the top left of the lines, and the list it opens */
      .hist-btn { pointer-events: auto; position: absolute; right: 100%; top: 0; margin-right: 6px; width: 1.45em;
        height: 1.45em; padding: 0; border: 0; border-radius: 50%; display: grid; place-items: center;
        background: rgba(0,0,0,.6); color: #fff; opacity: .55; cursor: pointer; transition: opacity .15s; }
      .hist-btn:hover, .hist-btn.open, .hist-btn:focus-visible { opacity: 1; }
      .hist-btn:focus-visible { outline: 2px solid #ffd54a; }
      .hist-btn svg { width: 62%; height: 62%; }
      /* The list is a side panel at the left of the player, so it doesn't cover the subtitles. */
      .hist { pointer-events: auto; position: fixed; width: min(34cqi, 400px); min-width: 220px; overflow-y: auto;
        display: flex; flex-direction: column; gap: 2px; padding: 8px 6px 6px; box-sizing: border-box;
        background: rgba(16,16,20,.9); border: 1px solid #3a3a40; border-radius: 10px;
        box-shadow: 0 6px 24px rgba(0,0,0,.5); font-size: calc(clamp(12px, 1.4cqi, 16px) * var(--scale, 1));
        animation: slide-in .18s ease-out; scrollbar-width: thin; }
      .hist::before { content: attr(aria-label); padding: 0 9px 4px; font-size: 11px; font-weight: 600;
        letter-spacing: .06em; text-transform: uppercase; color: #8d8d95; }
      @keyframes slide-in { from { opacity: 0; transform: translateX(-10px); } }
      @media (prefers-reduced-motion: reduce) { .hist { animation: none; } }
      .hist-item { padding: 4px 9px; border-radius: 6px; color: #fff; cursor: pointer; }
      .hist-item:hover, .hist-item:focus-visible { background: rgba(255,255,255,.08); outline: none; }
      .hist-item .h-trans { font-weight: 500; font-size: .9em; color: #d8d8dc; margin-top: 1px; transition: filter .15s; }
      .hist-item .h-trans.blur { filter: blur(5px); }
      [hidden] { display: none !important; }
    </style>
    <div class="frame"><div class="wrap">
      <div class="card" hidden role="dialog"></div>
      <div class="status" hidden></div>
      <div class="hist" id="hist" hidden role="list"></div>
      <div class="lines">
        <button class="hist-btn" hidden aria-expanded="false" aria-controls="hist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
        </button>
        <div class="box" aria-live="polite"></div>
      </div>
    </div></div>`;

  const box = root.querySelector(".box");
  const card = root.querySelector(".card");
  const statusEl = root.querySelector(".status");
  const hist = root.querySelector(".hist");
  const histBtn = root.querySelector(".hist-btn");
  card.ariaLabel = t("translation");
  hist.ariaLabel = histBtn.ariaLabel = histBtn.title = t("historyLabel");

  // Copies left from before an extension reload can't reach the extension any more, yet their
  // fullscreen handler still put their frozen lines back on screen. The live copy takes their hosts
  // away: marked ones anywhere, and unmarked ones from older versions by the overlay's z-index.
  function removeStrays() {
    const strays = [...document.querySelectorAll("[data-kavra-overlay]")];
    for (const parent of [document.documentElement, document.fullscreenElement]) {
      if (parent) strays.push(...parent.querySelectorAll(":scope > div[style*='2147483647']:not([data-kavra-overlay])"));
    }
    strays.forEach((el) => el !== host && el.remove());
  }
  removeStrays();

  let line = null; // the newest line on screen: { text, result, pending, reported, error }
  let previous = null; // the line before it, kept while the same stretch of speech goes on
  let silenced = false; // a pause in speech was reported since the newest line
  let shownAt = 0;
  let hideTimer;
  let hovering = false;
  let held = false; // the video is paused: keep the lines up
  let anchor = "bottom"; // "top" while the site's own subtitles stay on screen (speech recognition)
  let customPos = null; // where the user dragged the subtitles: 0 (top) to 1 (bottom) of the player
  const isTop = window === window.top;
  let trMode = "blur";
  let lazy = true; // in blur mode, translate a line only once the pointer is on it
  let locales = { orig: "en", trans: "en" }; // for case-insensitive matching
  let cardLine = null;
  let statusTimer;
  let errorShown = "";
  let historyOn = true;
  let recent = []; // the latest lines, newest last; those no longer on screen make up the history
  let histOpen = false; // false, "hover" (follows the pointer) or "pinned" (opened with a click or key)
  let histFocus = null; // the history line whose translation is revealed
  let histCloseTimer;

  const TEXT_SCALE = { s: 0.8, m: 1, l: 1.2 };
  const setTextSize = (size) => root.querySelector(".wrap").style.setProperty("--scale", TEXT_SCALE[size] ?? 1);

  getSettings().then(async (s) => {
    trMode = s.trMode;
    lazy = s.lazyTranslate;
    setTextSize(s.textSize);
    historyOn = s.lineHistory;
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
    if (!chrome.runtime?.id) return retire(); // left from before an extension reload
    removeStrays();
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
    Object.assign(hist.style, { left: `${left + 12}px`, top: `${top + 12}px`, maxHeight: `${Math.max(120, height * 0.75)}px` });
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
  // Players move and resize without telling anyone; also stop if the extension was reloaded.
  // Player iframes often appear only after a click on "play", so new frames are reported for the
  // reader and overlay to be injected into them too.
  let frameCount = document.querySelectorAll("iframe").length;
  const placeTimer = setInterval(() => {
    if (!chrome.runtime?.id) return retire();
    removeStrays();
    place();
    const frames = document.querySelectorAll("iframe").length;
    if (isTop && frames !== frameCount) {
      frameCount = frames;
      chrome.runtime.sendMessage({ type: "framesChanged" }).catch(() => {});
    }
  }, 400);

  function div(className, text) {
    const el = document.createElement("div");
    el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  // The newest line and, once it's ready, its translation; while someone keeps talking, the line
  // before it stays above, smaller, so nothing is lost between two quick lines. One translation
  // slot sits under them and shows the translation of whichever line the pointer is on.
  // Blurred translations open only when the pointer actually moves over a line: a cursor resting
  // on the video where a new line happens to appear doesn't reveal it.
  let focusLine = null; // the line whose translation is revealed; null = none
  let struggleTimer;

  function origLine(shown, className) {
    const spans = shown.result ? colourSpans(shown.result, shown.text) : null;
    const orig = paint(div(`line orig ${className}`), shown.text, spans?.orig);
    orig.tabIndex = 0;
    orig.title = t("clickHint");
    orig.addEventListener("click", () => !suppressClick && openCard(shown));
    orig.addEventListener("keydown", (e) => e.key === "Enter" && openCard(shown));
    orig.addEventListener("pointermove", () => reveal(shown));
    orig.addEventListener("focus", () => reveal(shown));
    return orig;
  }

  function render() {
    box.replaceChildren();
    if (line) {
      if (previous) box.appendChild(origLine(previous, "old"));
      box.appendChild(origLine(line, ""));
      const slot = div("line trans");
      slot.tabIndex = 0;
      slot.title = t("hoverHint");
      slot.addEventListener("pointermove", () => reveal(focusLine || line));
      slot.addEventListener("focus", () => reveal(focusLine || line));
      box.appendChild(slot);
      renderSlot();
    }
    renderHistory();
  }

  // Fills the slot: the revealed line's translation, else the newest one's (blurred in blur mode).
  function renderSlot() {
    const slot = box.querySelector(".trans");
    if (!slot) return;
    const target = focusLine === previous || focusLine === line ? focusLine || line : line;
    // A line translated on demand shows that it's coming while the pointer waits on it.
    const waiting = Boolean(focusLine) && target === focusLine && target.pending && !target.result;
    slot.classList.toggle("wait", waiting);
    if (trMode === "click" || (!target?.result && !waiting)) {
      slot.hidden = true;
      return;
    }
    slot.hidden = false;
    if (waiting) {
      slot.textContent = "…";
      slot.classList.remove("blur");
      return;
    }
    paint(slot, target.result.translation, colourSpans(target.result, target.text).trans);
    slot.classList.toggle("blur", trMode === "blur" && !focusLine);
    slot.classList.toggle("for-old", target === previous);
  }

  function reveal(target) {
    if (trMode === "click" || focusLine === target) return;
    focusLine = target;
    translateIfVisible(target, true); // asked for now, or a line kept from earlier without one yet
    renderSlot();
    noteStruggle(target);
  }

  // Revealing a blurred translation for a moment counts as "needed help" for the quiz.
  function noteStruggle(target) {
    clearTimeout(struggleTimer);
    if (trMode === "blur" && !target.reported) {
      struggleTimer = setTimeout(() => {
        target.reported = true;
        chrome.runtime.sendMessage({ type: "struggled", text: target.text }).catch(() => {});
      }, STRUGGLE_HOVER_MS);
    }
  }

  // ---- line history: the last lines that left the screen, listed from a button by the subtitles ----
  const pastLines = () => recent.filter((l) => l !== line && l !== previous).slice(-HISTORY_SIZE);

  function renderHistory() {
    const past = historyOn ? pastLines() : [];
    if (!past.length) histOpen = false;
    // The button shows with the subtitles (or while the video is paused), not alone over the video.
    histBtn.hidden = !past.length || !(line || held || histOpen);
    histBtn.classList.toggle("open", Boolean(histOpen));
    histBtn.ariaExpanded = String(Boolean(histOpen));
    hist.hidden = !histOpen;
    const focused = root.activeElement?.entry; // keep keyboard focus on its line across a rebuild
    hist.replaceChildren(...(histOpen ? past.map(histItem) : []));
    if (focused) [...hist.children].find((el) => el.entry === focused)?.focus();
  }

  function histItem(entry) {
    const item = div("hist-item");
    item.entry = entry;
    item.role = "listitem";
    item.tabIndex = 0;
    item.title = t("clickHint");
    const spans = entry.result ? colourSpans(entry.result, entry.text) : null;
    item.append(paint(div("h-orig"), entry.text, spans?.orig));
    if (trMode !== "click" && entry.result) {
      const tr = paint(div("h-trans"), entry.result.translation, spans.trans);
      tr.classList.toggle("blur", trMode === "blur" && histFocus !== entry);
      item.append(tr);
    }
    const focus = () => {
      if (histFocus === entry || trMode === "click") return;
      histFocus = entry;
      translateIfVisible(entry, true); // translated on demand, or shown in click mode: none yet
      noteStruggle(entry);
      if (entry.pending && !item.querySelector(".h-trans")) item.append(div("h-trans", "…"));
      item.querySelector(".h-trans")?.classList.remove("blur");
    };
    const blur = () => {
      if (histFocus !== entry) return;
      histFocus = null;
      clearTimeout(struggleTimer);
      item.querySelector(".h-trans")?.classList.toggle("blur", trMode === "blur");
    };
    item.addEventListener("pointermove", focus);
    item.addEventListener("focus", focus);
    item.addEventListener("pointerleave", blur);
    item.addEventListener("blur", blur);
    item.addEventListener("click", () => openCard(entry));
    item.addEventListener("keydown", (e) => e.key === "Enter" && openCard(entry));
    return item;
  }

  // Opens while the pointer is on the button or the list (with time to travel from one to the other);
  // a click (or Enter) keeps it open.
  function openHistory(how) {
    clearTimeout(histCloseTimer);
    if (histOpen === "pinned" || histOpen === how) return;
    histOpen = how;
    renderHistory();
  }
  function closeHistory() {
    clearTimeout(histCloseTimer);
    if (!histOpen) return;
    histOpen = false;
    histFocus = null;
    renderHistory();
  }
  function closeHistorySoon() {
    clearTimeout(histCloseTimer);
    if (histOpen === "hover") histCloseTimer = setTimeout(closeHistory, 700);
  }
  histBtn.addEventListener("pointermove", () => openHistory("hover"));
  histBtn.addEventListener("pointerleave", closeHistorySoon);
  histBtn.addEventListener("click", () => (histOpen === "pinned" ? closeHistory() : openHistory("pinned")));
  hist.addEventListener("pointerenter", () => clearTimeout(histCloseTimer));
  hist.addEventListener("pointerleave", closeHistorySoon);

  function conceal() {
    if (!focusLine) return;
    focusLine = null;
    clearTimeout(struggleTimer);
    renderSlot();
  }
  box.addEventListener("pointerleave", conceal);
  box.addEventListener("focusout", (e) => !box.contains(e.relatedTarget) && conceal());

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
  // asked: the pointer is on the line. Otherwise lines in blur mode wait for that, if set to.
  function translateIfVisible(target, asked = false) {
    if (trMode === "click" || !displaying() || document.visibilityState !== "visible") return;
    if (trMode === "blur" && lazy && !asked) return;
    if (target.result || target.pending) return;
    target.pending = true;
    requestTranslation(target, true);
  }

  function onCaption(text, source) {
    anchor = source === "page" ? "bottom" : "top";
    previous = line && !silenced ? line : null;
    silenced = false;
    line = { text, result: null, pending: false };
    recent.push(line);
    if (recent.length > HISTORY_SIZE + 2) recent.shift();
    focusLine = null; // a new line starts blurred, wherever the cursor is
    clearTimeout(struggleTimer);
    shownAt = Date.now();
    clearTimeout(hideTimer);
    translateIfVisible(line);
    attach();
    render();
  }

  // Nobody has spoken for a moment: let the line go once it has been up long enough to read, and not
  // while the reader is pointing at it or has its card open.
  function onClear() {
    silenced = true;
    if (!line) return;
    const readFor = Math.min(5000, 1800 + line.text.length * 45);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideLine, Math.max(0, shownAt + readFor - Date.now()));
  }
  function hideLine() {
    if (held) return; // playing again sends a fresh "clear" after a moment of silence
    if (cardLine || hovering || histOpen) {
      hideTimer = setTimeout(hideLine, 800);
      return;
    }
    line = null;
    previous = null;
    focusLine = null;
    render();
  }
  box.addEventListener("pointerenter", () => (hovering = true));
  box.addEventListener("pointerleave", () => (hovering = false));

  function onVisibility() {
    if (line) translateIfVisible(line);
  }

  // Page listeners outlive the extension, so a copy that lost it must remove them too.
  function unlisten() {
    clearInterval(placeTimer);
    document.removeEventListener("fullscreenchange", attach);
    removeEventListener("resize", place);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("visibilitychange", onVisibility);
  }
  function retire() {
    unlisten();
    host.remove();
  }

  function teardown(message) {
    chrome.runtime.onMessage.removeListener(onMessage);
    chrome.storage.onChanged.removeListener(onStorage);
    unlisten();
    window.__kavraOverlay = null;
    closeCard();
    line = previous = null;
    recent = [];
    render();
    if (message) {
      showStatus(message, true);
      setTimeout(() => host.remove(), 8000);
    } else {
      host.remove();
    }
  }

  function onMessage(msg) {
    if (msg.type === "caption") onCaption(msg.text, msg.source);
    else if (msg.type === "clear") onClear();
    else if (msg.type === "hold") {
      held = msg.on;
      if (held) clearTimeout(hideTimer);
      renderHistory();
    }
    else if (msg.type === "status") showStatus(msg.text, msg.error);
    else if (msg.type === "stop") teardown(msg.message);
  }

  function onStorage(changes, area) {
    if (area !== "local") return;
    if (changes.targetLang || changes.nativeLang) {
      // Lines on screen belong to the old language pair.
      locales = { orig: changes.targetLang?.newValue || locales.orig, trans: changes.nativeLang?.newValue || locales.trans };
      closeCard();
      line = previous = null;
      recent = [];
      render();
    }
    if (changes.lineHistory) {
      historyOn = changes.lineHistory.newValue ?? true;
      renderHistory();
    }
    if (changes.textSize) {
      setTextSize(changes.textSize.newValue);
      place();
    }
    if ("overlayPos" in changes) {
      customPos = changes.overlayPos.newValue ?? null;
      place();
    }
    if (changes.lazyTranslate) lazy = changes.lazyTranslate.newValue ?? true;
    if (!changes.trMode && !changes.lazyTranslate) return;
    trMode = changes.trMode?.newValue || trMode;
    // A line shown while in click mode has no translation yet.
    if (line) translateIfVisible(line);
    render();
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      closeCard();
      closeHistory();
    }
  }

  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorage);
  document.addEventListener("fullscreenchange", attach);
  addEventListener("resize", place);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("visibilitychange", onVisibility);
  attach();
})();
