// Shared by every extension context: pages, content scripts and (bundled into) the service worker.
// A classic script that may be injected more than once, so it only defines a global once.
globalThis.Kavra ??= (() => {
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

  // AI providers. Every one except Anthropic speaks the OpenAI chat-completions protocol.
  // Default models are starting points; the settings page can list a provider's current models.
  const PROVIDERS = {
    anthropic: { name: "Anthropic Claude", model: "claude-haiku-5-5", keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-…" },
    openai: { name: "OpenAI", model: "gpt-5-mini", base: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-…" },
    gemini: { name: "Google Gemini", model: "gemini-flash-latest", base: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey", keyHint: "AIza…" },
    deepseek: { name: "DeepSeek", model: "deepseek-v4-flash", base: "https://api.deepseek.com", keyUrl: "https://platform.deepseek.com/api_keys", keyHint: "sk-…" },
    xai: { name: "xAI Grok", model: "grok-4.3", base: "https://api.x.ai/v1", keyUrl: "https://console.x.ai", keyHint: "xai-…" },
    openrouter: { name: "OpenRouter", model: "~google/gemini-flash-latest", base: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", keyHint: "sk-or-…" },
  };

  const uiLang = chrome.i18n.getUILanguage().split("-")[0];
  const DEFAULTS = {
    targetLang: uiLang === "en" ? "es-ES" : "en-US",
    nativeLang: NATIVE_LANGS.includes(uiLang) ? uiLang : "en",
    level: "B1",
    quizMinutes: 20,
    source: "auto",
    trMode: "blur",
    textSize: "m", // subtitle text: "s", "m" or "l"
    lazyTranslate: true, // in blur mode, translate a line only when the pointer is on it
    lineHistory: true, // a button by the subtitles that lists the last lines
    provider: "anthropic",
    apiKeys: {}, // provider id -> key, so switching providers keeps each key
    models: {}, // provider id -> model chosen by the user
    onboarded: false,
  };

  // Adds the active provider's key and model as settings.key / settings.model.
  async function getSettings() {
    const stored = await chrome.storage.local.get([...Object.keys(DEFAULTS), "apiKey"]);
    const s = { ...DEFAULTS, ...stored };
    if (!PROVIDERS[s.provider]) s.provider = DEFAULTS.provider;
    // Versions before 0.6 stored a single Anthropic key.
    if (stored.apiKey && !s.apiKeys.anthropic) s.apiKeys = { ...s.apiKeys, anthropic: stored.apiKey };
    s.key = s.apiKeys[s.provider] || "";
    s.model = s.models[s.provider] || PROVIDERS[s.provider].model;
    return s;
  }

  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
  const baseLang = (code) => code.split("-")[0].toLowerCase();
  const pad = (n) => String(n).padStart(2, "0");
  // Local calendar day, used as the key of daily activity records.
  const dayKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  function languageName(code, inLang = "en") {
    try {
      return new Intl.DisplayNames([inLang], { type: "language" }).of(code) || code;
    } catch {
      return code;
    }
  }

  // "German — Deutsch": the UI-language name plus the language's own name, so people find their language.
  function fillLanguageSelect(select, codes) {
    const ui = chrome.i18n.getUILanguage();
    const label = (code) => {
      const own = languageName(code, code);
      const local = languageName(code, ui);
      return own === local ? local : `${local} — ${own}`;
    };
    const options = codes.map((code) => [code, label(code)]).sort((a, b) => a[1].localeCompare(b[1], ui));
    for (const [value, text] of options) select.add(new Option(text, value));
  }

  // Fills elements marked data-i18n / data-i18n-placeholder / data-i18n-aria-label on extension pages.
  function localizePage() {
    document.documentElement.lang = chrome.i18n.getUILanguage();
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
    for (const el of document.querySelectorAll("[data-i18n-aria-label]")) el.ariaLabel = t(el.dataset.i18nAriaLabel);
    document.title = t(document.title);
  }

  return {
    TARGET_LOCALES, NATIVE_LANGS, LEVELS, PROVIDERS, DEFAULTS,
    getSettings, t, baseLang, dayKey, languageName, fillLanguageSelect, localizePage,
  };
})();
