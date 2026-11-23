# Kavra

*Kavra* is Turkish for "grasp": understand what's said, not just read the translation.

A Chrome extension for learning a language from any video on the web: YouTube, Netflix, or any site with a video player. Pick the language you're learning and your own language. The extension then shows live subtitles with a colour-matched translation underneath, explains a line when you click it, and quizzes you on what you watched.

Translations and quizzes are made by the AI provider you choose (Anthropic Claude, OpenAI, Google Gemini, DeepSeek, xAI Grok or OpenRouter) with your own API key.

## Features

- **Any language pair.** For example English → Turkish, German → English or Japanese → Spanish. Choose both languages in Settings.
- **Works on any site.** The extension reads the site's own subtitles: HTML5 `<track>` subtitles, YouTube, Netflix, common web players (JW Player, Video.js, Plyr, Shaka, MediaElement, Flowplayer, ArtPlayer, DPlayer, Vidstack, Clappr), and for any other player it finds the element whose text keeps changing over the video. Players embedded from another site are read too. When a video has no subtitles, it turns the tab's audio into text with Chrome's speech recognition.
- **Colour-matched dual subtitles.** Chunks of the original line and of the translation that mean the same thing share a colour.
- **Three translation modes:**
  - **Blurred:** the translation stays blurred until you hover over it, so you try to understand first.
  - **Always show.**
  - **Only on click.**
- **Click to explain.** Clicking a line pauses the video and shows the translation with notes on idioms and harder words.
- **Word pool.** The card has a button that saves the line with its translation and notes to your word pool, a page where you can search and remove saved lines, and take a review quiz on a random handful of them (fill the gap, meaning and translation questions).
- **5000 core English words.** The most frequent English words as a pile of cards, most frequent first. Swipe right (or →) if you know a word, left (←) if you don't, up (↑) if you're not sure; tap a card for its meaning and an example in your language, written by your AI provider. Words you don't know or aren't sure of are listed and come back in Review.
- **Quizzes.** After a set amount of watching (20 minutes by default), the video pauses and a 6-question quiz on what was said opens in a new tab. Questions are in the language you're learning and explanations are in yours. Lines you needed help with are used for the vocabulary questions. Every quiz is kept on the Quizzes page, where you can finish it later or look back at your answers.
- **Activity history.** A listening waveform of the minutes you practised each day, monthly totals, your streak, lines heard and looked up, and quiz answers right and wrong, day by day.
- **Any AI provider.** Each provider keeps its own key and model, and the settings page can load the provider's current model list.
- The interface is in English or Turkish, following your browser language.

## Install

1. Install and build:

   ```bash
   npm install
   ```

   ```bash
   npm run build
   ```

2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension/` folder.
4. Open the extension's **Settings**. Choose the language you're learning and your language, pick an AI provider and paste its API key.

To use it, open a video, click the extension icon and press **Start captions in this tab**. For the best results, turn on subtitles in the language you're learning in the video player.

## AI providers

| Provider | Default model | Get a key |
| --- | --- | --- |
| Anthropic Claude | `claude-haiku-5-5` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| OpenAI | `gpt-5-mini` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Google Gemini | `gemini-flash-latest` | [aistudio.google.com](https://aistudio.google.com/apikey) |
| DeepSeek | `deepseek-v4-flash` | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| xAI Grok | `grok-4.3` | [console.x.ai](https://console.x.ai) |
| OpenRouter | `~google/gemini-flash-latest` | [openrouter.ai](https://openrouter.ai/keys) |

Model names change often. If a default model stops working, open Settings, press **Load models** and pick one from your provider's current list. Claude goes through the Anthropic SDK; the others use the OpenAI-compatible chat API with JSON output, and Kavra checks every response against the expected format.

## Cost

Each translated line is one small request and each quiz is one larger request, billed by your provider. With a small, fast model a typical episode costs a few cents. In "Only on click" mode, a line is translated only when you click it.

## Privacy

- Your API keys are stored only in this browser's extension storage, and each key is sent only to its own provider.
- Subtitle text is sent to the provider you picked for translation and quizzes.
- Activity history stays in this browser.
- Speech recognition, used only when a video has no subtitles, is Chrome's Web Speech API, which sends the audio to Google. Choose "The site's subtitles only" in Settings to turn it off.

## Limitations

- Recognising speech from tab audio needs a recent version of Chrome. On older versions you'll see an error, and you can still use the site's own subtitles.
- Chrome asks for access to all sites when you install Kavra, because players are often embedded from another site. Kavra only runs in a tab after you switch subtitles on there.
- For an unknown player, Kavra needs to see three subtitle lines change before it recognises the subtitle box, so the first lines can come from speech recognition.
- The YouTube and Netflix readers depend on how those sites build their pages and may need updating when the sites change.
- If a video inside an `<iframe>` goes fullscreen, the extension's subtitles aren't visible in fullscreen.
- YouTube's auto-generated subtitles sometimes arrive as two pieces of one sentence.

## Project layout

| Path | What it does |
| --- | --- |
| `src/background.js` | Service worker: picks the subtitle source, routes captions, caches translations, triggers quizzes. |
| `src/llm.js` | Translation and quiz requests: Anthropic SDK or any OpenAI-compatible provider. |
| `extension/settings.js` | Shared settings, language lists and i18n helpers. |
| `extension/reader.js` | Runs in every frame: reads the site's subtitles and pauses or resumes videos. |
| `extension/overlay.js` | The on-video subtitles, blur mode and translation card. |
| `extension/offscreen.js` | Captures tab audio and runs speech recognition. |
| `extension/charts.js` | Activity totals, streaks, the daily waveform and monthly bars. |
| `extension/popup.*`, `options.*`, `quiz.*`, `activity.*`, `words.*`, `deck.*`, `onboarding.*` | Toolbar menu, settings, quiz, activity, word pool, core words and first-run setup pages. |
| `extension/core-words.txt`, `tools/core-words.py` | The core English deck and the script that builds it from [wordfreq](https://github.com/rspeer/wordfreq) (word list data CC BY-SA 4.0). |
| `extension/nav.js` | Top bar shared by the full pages. |
| `extension/_locales/` | Interface text (`en`, `tr`). |

`npm run build` bundles `src/` with the Anthropic SDK into `extension/background.js`. Run `npm run watch` while developing.

To add an interface language, copy `extension/_locales/en/messages.json` to a folder named after the language code and translate the messages.

## License

[MIT](LICENSE)
