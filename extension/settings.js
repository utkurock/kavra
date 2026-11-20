// Shared by every extension context: pages, content scripts and (bundled into) the service worker.
// A classic script that may be injected more than once, so it only defines a global once.
globalThis.Lingo ??= (() => {
  // Languages offered as "the language you're learning", as speech-recognition locales.
  const TARGET_LOCALES = [
    "en-US", "en-GB", "en-AU", "en-IN", "de-DE", "fr-FR", "es-ES", "es-MX", "it-IT", "pt-BR", "pt-PT",
    "nl-NL", "sv-SE", "da-DK", "nb-NO", "fi-FI", "pl-PL", "cs-CZ", "ro-RO", "el-GR", "hu-HU", "ru-RU",
    "uk-UA", "tr-TR", "ar-SA", "he-IL", "fa-IR", "hi-IN", "id-ID", "vi-VN", "th-TH", "ja-JP", "ko-KR",
    "zh-CN", "zh-TW",
  ];
  // Languages offered as "your language" (translations and explanations are written in it).
  const NATIVE_LANGS = [
    "ar", "bg", "bn", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fr", "he", "hi", "hr", "hu", "id",
    "it", "ja", "ko", "lt", "lv", "ms", "nb", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sr", "sv", "th",
    "tr", "uk", "ur", "vi", "zh",
  ];
  const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

  const uiLang = chrome.i18n.getUILanguage().split("-")[0];
  const DEFAULTS = {
    targetLang: uiLang === "en" ? "es-ES" : "en-US",
    nativeLang: NATIVE_LANGS.includes(uiLang) ? uiLang : "en",
    level: "B1",
    quizMinutes: 20,
    source: "auto",
    trMode: "blur",
  };

  async function getSettings() {
    return { ...DEFAULTS, ...(await chrome.storage.local.get([...Object.keys(DEFAULTS), "apiKey"])) };
  }

  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
  const baseLang = (code) => code.split("-")[0].toLowerCase();
  function languageName(code, inLang = "en") {
    try {
      return new Intl.DisplayNames([inLang], { type: "language" }).of(code) || code;
    } catch {
      return code;
    }
  }

  // Fills elements marked data-i18n / data-i18n-placeholder / data-i18n-aria-label on extension pages.
  function localizePage() {
    document.documentElement.lang = chrome.i18n.getUILanguage();
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
    for (const el of document.querySelectorAll("[data-i18n-aria-label]")) el.ariaLabel = t(el.dataset.i18nAriaLabel);
    document.title = t(document.title);
  }

  return { TARGET_LOCALES, NATIVE_LANGS, LEVELS, DEFAULTS, getSettings, t, baseLang, languageName, localizePage };
})();
