// Offscreen document: turns the captured tab audio into text with Chrome's speech recognition.
const params = new URLSearchParams(location.search);
const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);

let track;
let running = true;
let listening = true; // false while the site's own subtitles are being used
let rec;

function send(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// Codes map to "speech_<code>" messages in the service worker (offscreen pages have no chrome.i18n).
function fail(code, detail) {
  running = false;
  send({ type: "captionError", code, detail });
}

function listen() {
  const Recognition = self.SpeechRecognition || self.webkitSpeechRecognition;
  rec = new Recognition();
  rec.lang = params.get("lang") || "en-US";
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript.trim();
      if (!text) continue;
      if (event.results[i].isFinal) send({ type: "caption", text, final: true });
      else interim += `${text} `;
    }
    if (interim) send({ type: "caption", text: interim.trim(), final: false });
  };

  rec.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "audio-capture") {
      fail("trackUnsupported");
    } else if (FATAL.has(event.error)) {
      fail("error", event.error);
    }
    // "no-speech", "aborted", "network": onend restarts recognition.
  };

  // Recognition sessions end on their own after a while; keep going while the tab is captured.
  rec.onend = () => {
    rec = null;
    if (running && listening && track.readyState === "live") setTimeout(() => listening && !rec && listen(), 300);
  };

  rec.start(track);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen" || msg.type !== "setListening") return;
  listening = msg.on;
  if (!listening) rec?.abort();
  else if (!rec && track && running) listen();
});

async function main() {
  if (!(self.SpeechRecognition || self.webkitSpeechRecognition)) {
    return fail("noApi");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: params.get("streamId") } },
    video: false,
  });
  // Capturing mutes the tab, so play the audio back to the user.
  const audio = new AudioContext();
  audio.createMediaStreamSource(stream).connect(audio.destination);

  track = stream.getAudioTracks()[0];
  track.onended = () => fail("captureEnded");
  listen();
}

main().catch((err) => fail("captureFailed", err.message));
