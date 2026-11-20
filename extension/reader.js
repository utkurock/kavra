// Runs in every frame of the captioned tab: reads the site's own subtitles and pauses/resumes videos.
(() => {
  if (window.__kavraReader) return;
  window.__kavraReader = true;

  const clean = (s) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => {});
  const emit = (text, final) => send({ type: "pageCaption", text, final });

  const { getSettings, baseLang, languageName } = globalThis.Kavra;
  let isTarget = () => false;

  // ---- 1. Standard HTML5 subtitle tracks (<track>, most generic players) ----
  const tracks = new Map(); // TextTrack -> { prevMode, onCueChange }

  function pickTrack(video) {
    const list = [...video.textTracks].filter((t) => t.kind === "subtitles" || t.kind === "captions");
    return (
      list.find((t) => isTarget(t) && t.mode === "showing") ||
      list.find(isTarget) ||
      list.find((t) => !t.language && t.mode === "showing")
    );
  }

  function watchTrack(track) {
    if (tracks.has(track)) return;
    let last = "";
    const onCueChange = () => {
      const active = [...(track.activeCues || [])];
      const text = clean(active.map((c) => c.text).join(" "));
      if (!text) return void (last = "");
      if (text === last) return;
      last = text;
      emit(text, true);
      // Translate the next few cues ahead of time so they show up without delay.
      const end = Math.max(...active.map((c) => c.endTime));
      // Only while the tab is in view: a video playing in the background shouldn't spend tokens.
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
    for (const video of document.querySelectorAll("video")) {
      const track = pickTrack(video);
      if (track) watchTrack(track);
    }
  }

  // ---- 2. Sites that draw subtitles into the page instead of using tracks ----
  const DOM_SOURCES = [
    {
      host: /(^|\.)youtube(-nocookie)?\.com$/,
      lines: () => [...document.querySelectorAll(".caption-visual-line")].map((el) => el.textContent),
      hideCss: ".ytp-caption-window-container { opacity: 0 !important; }",
      stableMs: 900, // auto-generated captions grow word by word
    },
    {
      host: /(^|\.)netflix\.com$/,
      lines: () => [...document.querySelectorAll(".player-timedtext-text-container")].map((el) => el.innerText),
      hideCss: ".player-timedtext { opacity: 0 !important; }",
      stableMs: 250,
    },
  ];
  const domSource = DOM_SOURCES.find((s) => s.host.test(location.hostname));
  let hideStyle;
  const seen = new Map(); // visible line text -> first time seen
  const recentFinals = [];
  let lastInterim = "";

  function finalize(text) {
    if (recentFinals.includes(text)) return;
    recentFinals.push(text);
    if (recentFinals.length > 12) recentFinals.shift();
    emit(text, true);
  }

  function pollDom() {
    const visible = domSource.lines().map(clean).filter(Boolean);
    if (visible.length && !hideStyle) {
      hideStyle = document.createElement("style");
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
    const interim = visible.filter((t) => !recentFinals.includes(t)).at(-1) || "";
    if (interim && interim !== lastInterim) emit(interim, false);
    lastInterim = interim;
  }

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

  // Match tracks of the language being learned by code, or by name when the site gives no code.
  function useLanguage(targetLang) {
    const base = baseLang(targetLang);
    const labels = [languageName(base), languageName(base, base)].map((n) => n.toLowerCase());
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
    domTimer = domSource ? setInterval(pollDom, 250) : null;
    chrome.storage.onChanged.addListener(onStorage);
  });

  function stop() {
    clearInterval(scanTimer);
    clearInterval(domTimer);
    releaseTracks();
    chrome.storage.onChanged.removeListener(onStorage);
    hideStyle?.remove();
    chrome.runtime.onMessage.removeListener(onMessage);
    window.__kavraReader = false;
  }

  function onMessage(msg) {
    if (msg.type === "media") media(msg.action);
    else if (msg.type === "stop") stop();
  }
  chrome.runtime.onMessage.addListener(onMessage);
})();
