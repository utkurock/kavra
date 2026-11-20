// Runs in every frame of the captioned tab: reads the site's own subtitles and pauses/resumes videos.
(() => {
  // A copy left from before the extension was reloaded can't reach the extension any more, so a new
  // injection replaces it instead of stepping aside.
  if (window.__kavraReader?.alive?.()) return;
  document.querySelectorAll("style[data-kavra-hide]").forEach((el) => el.remove());
  window.__kavraReader = { alive: () => Boolean(chrome.runtime?.id) };

  const clean = (s) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const send = (message) => {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      stop(); // the extension was reloaded
    }
  };
  // rolling: the text is a piece of captions that roll in word by word, to be joined into sentences.
  const emit = (text, rolling = false) => send({ type: "pageCaption", text, final: true, rolling });
  // The site's subtitle went away: tells the overlay to let its line go after a moment of silence.
  const emitClear = () => send({ type: "pageClear" });

  const { getSettings, baseLang, languageName } = globalThis.Kavra;
  let isTarget = () => false;

  // ---- 1. HTML5 subtitle tracks: <track> elements and the tracks many players add for their cues ----
  const tracks = new Map(); // TextTrack -> { prevMode, onCueChange }
  let trackCueAt = 0; // when a watched track last showed a line

  // Prefer the learning language; otherwise follow whatever track is switched on, since lines in
  // another language are filtered out by language detection later.
  function pickTrack(video) {
    const list = [...video.textTracks].filter((t) => t.kind === "subtitles" || t.kind === "captions");
    return (
      list.find((t) => isTarget(t) && t.mode === "showing") ||
      list.find(isTarget) ||
      list.find((t) => t.mode === "showing")
    );
  }

  function watchTrack(track) {
    if (tracks.has(track)) return;
    let last = "";
    const onCueChange = () => {
      const active = [...(track.activeCues || [])];
      const text = clean(active.map((c) => c.text).join(" "));
      if (!text) {
        if (last) emitClear();
        last = "";
        return;
      }
      trackCueAt = Date.now();
      if (text === last) return;
      last = text;
      emit(text);
      // Translate the next cues ahead of time so they show up without delay, but only while the tab is
      // in view: a video playing in the background shouldn't spend tokens.
      const end = Math.max(...active.map((c) => c.endTime));
      const upcoming = [...(track.cues || [])].filter((c) => c.startTime >= end).slice(0, 2);
      if (upcoming.length && document.visibilityState === "visible") {
        send({ type: "prefetch", texts: upcoming.map((c) => clean(c.text)).filter(Boolean) });
      }
    };
    tracks.set(track, { prevMode: track.mode, onCueChange });
    track.mode = "hidden"; // keeps cues flowing but hides the native rendering; our overlay shows them
    track.addEventListener("cuechange", onCueChange);
  }

  function scanVideos() {
    watchForPlayers();
    for (const video of document.querySelectorAll("video")) {
      const track = pickTrack(video);
      if (track) watchTrack(track);
    }
  }

  // ---- 2. Players that draw subtitles into the page instead of using tracks ----
  const siteSource = (lineSelector, hideSelector, stableMs, rolling = false) => ({
    lines: () => [...document.querySelectorAll(lineSelector)].map((el) => el.innerText || el.textContent),
    hideCss: `${hideSelector} { opacity: 0 !important; }`,
    stableMs,
    rolling,
  });
  const DOM_SOURCES = [
    // auto-generated captions grow word by word, so a line counts as finished after a short pause
    { host: /(^|\.)youtube(-nocookie)?\.com$/, ...siteSource(".caption-visual-line", ".ytp-caption-window-container", 900, true) },
    { host: /(^|\.)netflix\.com$/, ...siteSource(".player-timedtext-text-container", ".player-timedtext", 250) },
  ];
  // Caption elements of widely embedded web players (JW Player, Video.js, Plyr, Shaka, MediaElement,
  // Flowplayer, ArtPlayer, DPlayer, Vidstack, Clappr), used on any other site.
  const PLAYER_CAPTIONS = [
    ".jw-text-track-cue", ".vjs-text-track-cue", ".plyr__caption", ".shaka-text-container",
    ".mejs__captions-text", ".fp-captions", ".art-subtitle", ".dplayer-subtitle",
    "media-captions [data-part='cue']", ".cc-controls-subtitle",
  ].join(", ");
  const domSource =
    DOM_SOURCES.find((s) => s.host.test(location.hostname)) || siteSource(PLAYER_CAPTIONS, PLAYER_CAPTIONS, 250);
  let hideStyle;

  // ---- 3. Any other player: find the element whose text keeps changing over the video ----
  // Subtitles are text with letters, inside the video's area, that changes every few seconds; the
  // player's clock ("17:14 / 1:00:14") has no letters and is ignored. After three different lines
  // the element is taken as the subtitle and read like the known players above.
  const AUTO_LOCK_CHANGES = 3;
  let autoEl = null;
  let autoPrevOpacity = "";
  let candidates = new WeakMap(); // element -> { last, changes }
  let observer = null;

  function videoRects() {
    return [...document.querySelectorAll("video")]
      .map((v) => v.getBoundingClientRect())
      .filter((r) => r.width > 200 && r.height > 100);
  }

  // The element to watch for a changed node: climb while the parent still looks like a caption box.
  function captionBox(node, video) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el || el.closest("video") || el.querySelector?.("video")) return null;
    for (let parent = el.parentElement; parent && !parent.querySelector("video"); parent = parent.parentElement) {
      const r = parent.getBoundingClientRect();
      if (r.height > video.height * 0.4 || clean(parent.innerText || "").length > 300) break;
      el = parent;
    }
    return el;
  }

  function onMutations(records) {
    // Something better is already being read: a found caption box, a track with lines, a known player.
    if (autoEl?.isConnected || Date.now() - trackCueAt < 10000 || hideStyle) return;
    const videos = videoRects();
    if (!videos.length) return;
    for (const record of records) {
      for (const video of videos) {
        const el = captionBox(record.target, video);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const inside = r.width > 0 && r.top >= video.top - 4 && r.bottom <= video.bottom + 4 &&
          r.left >= video.left - 4 && r.right <= video.right + 4;
        const text = clean(el.innerText || "");
        if (!inside || !/\p{L}/u.test(text) || text.length > 300) continue;
        const seen = candidates.get(el) || { last: "", changes: 0 };
        if (text !== seen.last) seen.changes++;
        seen.last = text;
        candidates.set(el, seen);
        if (seen.changes >= AUTO_LOCK_CHANGES) {
          autoEl = el;
          autoPrevOpacity = el.style.getPropertyValue("opacity");
          el.style.setProperty("opacity", "0", "important"); // our overlay shows it instead
          return;
        }
      }
    }
  }

  function watchForPlayers() {
    if (observer || !document.querySelector("video")) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  function releaseAuto() {
    if (autoEl) autoEl.style.setProperty("opacity", autoPrevOpacity);
    autoEl = null;
    candidates = new WeakMap();
  }

  function readLines() {
    const known = domSource.lines();
    if (known.length) return known;
    if (autoEl && !autoEl.isConnected) releaseAuto(); // the player rebuilt its caption box
    return autoEl ? [autoEl.innerText || autoEl.textContent] : [];
  }
  const seen = new Map(); // visible line text -> first time seen
  const recentFinals = [];
  let wasShowing = false;

  function finalize(text) {
    if (recentFinals.includes(text)) return;
    // A line that kept growing after it was sent once: send only what's new.
    const earlier = recentFinals.findLast((r) => text.startsWith(r));
    recentFinals.push(text);
    if (recentFinals.length > 12) recentFinals.shift();
    const fresh = earlier ? text.slice(earlier.length).trim() : text;
    if (fresh) emit(fresh, Boolean(domSource.rolling));
  }

  function pollDom() {
    const known = domSource.lines().map(clean).filter(Boolean);
    const visible = known.length ? known : readLines().map(clean).filter(Boolean);
    if (known.length && !hideStyle) {
      hideStyle = document.createElement("style");
      hideStyle.dataset.kavraHide = "";
      hideStyle.textContent = domSource.hideCss;
      document.documentElement.appendChild(hideStyle);
    }
    const now = Date.now();
    for (const [text] of seen) {
      if (visible.includes(text)) continue;
      seen.delete(text);
      // A line that disappeared without growing into a longer one is complete.
      if (!visible.some((v) => v.startsWith(text))) finalize(text);
    }
    for (const text of visible) {
      if (!seen.has(text)) seen.set(text, now);
      else if (now - seen.get(text) >= domSource.stableMs) finalize(text);
    }
    if (wasShowing && !visible.length) emitClear();
    wasShowing = visible.length > 0;
  }

  // ---- playback: while a video is paused its subtitles stay on screen ----
  // Media events don't bubble, so they're caught on the way down.
  function onPlayback(e) {
    if (e.target instanceof HTMLVideoElement) send({ type: "playback", paused: e.type === "pause" });
  }
  document.addEventListener("pause", onPlayback, true);
  document.addEventListener("play", onPlayback, true);

  // ---- video control (requested by the overlay or before a quiz) ----
  let pausedByUs = [];
  function media(action) {
    if (action === "pause") {
      const playing = [...document.querySelectorAll("video")].filter((v) => !v.paused);
      playing.forEach((v) => v.pause());
      pausedByUs = pausedByUs.concat(playing);
    } else if (action === "resume") {
      pausedByUs.forEach((v) => v.play().catch(() => {}));
      pausedByUs = [];
    }
  }

  let scanTimer;
  let domTimer;

  function releaseTracks() {
    for (const [track, { prevMode, onCueChange }] of tracks) {
      track.removeEventListener("cuechange", onCueChange);
      track.mode = prevMode;
    }
    tracks.clear();
  }

  // Match tracks of the language being learned by code, or by name (in English, in the language
  // itself, or in the browser's language) when the site gives no code.
  function useLanguage(targetLang) {
    const base = baseLang(targetLang);
    const labels = [languageName(base), languageName(base, base), languageName(base, chrome.i18n.getUILanguage())]
      .map((n) => n.toLowerCase());
    isTarget = (t) =>
      (t.language ? baseLang(t.language) === base : labels.some((n) => t.label.toLowerCase().includes(n)));
    releaseTracks();
    scanVideos();
  }

  function onStorage(changes, area) {
    if (area === "local" && changes.targetLang) useLanguage(changes.targetLang.newValue);
  }

  getSettings().then(({ targetLang }) => {
    if (!window.__kavraReader) return; // stopped meanwhile
    useLanguage(targetLang);
    scanTimer = setInterval(scanVideos, 2000);
    domTimer = setInterval(pollDom, 250);
    watchForPlayers();
    chrome.storage.onChanged.addListener(onStorage);
  });

  function stop() {
    clearInterval(scanTimer);
    clearInterval(domTimer);
    releaseTracks();
    hideStyle?.remove();
    observer?.disconnect();
    releaseAuto();
    document.removeEventListener("pause", onPlayback, true);
    document.removeEventListener("play", onPlayback, true);
    try {
      chrome.storage.onChanged.removeListener(onStorage);
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // the extension was reloaded; nothing left to unregister from
    }
    window.__kavraReader = null;
  }

  function onMessage(msg) {
    if (msg.type === "media") media(msg.action);
    else if (msg.type === "stop") stop();
  }
  chrome.runtime.onMessage.addListener(onMessage);
})();
