// Claude Haiku calls: line translation and quiz generation, for any learning/native language pair.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import "../extension/settings.js";

const { t, languageName, baseLang } = globalThis.Lingo;
const MODEL = "claude-haiku-5-5";

const TranslationSchema = z.object({
  translation: z.string(),
  pairs: z.array(z.object({ original: z.string(), translated: z.string() })),
  notes: z.array(z.object({ phrase: z.string(), meaning: z.string() })),
});

const QuizSchema = z.object({
  questions: z.array(
    z.object({
      kind: z.enum(["comprehension", "vocabulary", "listening"]),
      question: z.string(),
      quote: z.string(),
      options: z.array(z.string()),
      correct_index: z.number().int(),
      explanation: z.string(),
    })
  ),
});

function names(settings) {
  return { target: languageName(settings.targetLang), native: languageName(settings.nativeLang) };
}

function getClient(settings) {
  if (!settings.apiKey) throw new Error(t("errNoKey"));
  // The key lives only in this extension's local storage and is sent only to api.anthropic.com.
  return new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
}

export function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return t("errBadKey");
  if (err instanceof Anthropic.PermissionDeniedError) return t("errPermission");
  if (err instanceof Anthropic.RateLimitError) return t("errRateLimit");
  if (err instanceof Anthropic.APIConnectionError) return t("errConnection");
  if (err instanceof Anthropic.APIError) return t("errApi", err.status, err.message);
  return err?.message || String(err);
}

function parsedOrThrow(response) {
  if (response.stop_reason === "refusal") throw new Error(t("errRefusal"));
  if (response.stop_reason === "max_tokens") throw new Error(t("errTruncated"));
  if (!response.parsed_output) throw new Error(t("errUnreadable"));
  return response.parsed_output;
}

export async function translateLine(line, context, settings) {
  const client = getClient(settings);
  const { target, native } = names(settings);
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(TranslationSchema) },
    system:
      `You help a learner whose native language is ${native} learn ${target} from videos. The ${target} ` +
      "text comes from video subtitles or automatic speech recognition, so it may lack punctuation or " +
      `contain small mistakes; translate what was most likely said. Give a natural ${native} translation ` +
      "of the line.\n" +
      "pairs: split the line into 2-6 meaningful chunks (phrases, not lone articles or fillers) and give " +
      "the matching chunk of your translation for each, so the learner can see which part means what. " +
      "original must be copied exactly from the line and translated exactly from your translation; chunks " +
      "must not overlap. A one- or two-word line may have a single pair.\n" +
      "notes: up to 3 idioms, phrasal verbs, slang or less common words from the line, each with its " +
      `meaning in this context written in ${native}. Leave notes empty if the line is simple.`,
    messages: [
      {
        role: "user",
        content: `Preceding lines (context only):\n${context || "(none)"}\n\nLine to translate:\n${line}`,
      },
    ],
  });
  return parsedOrThrow(response);
}

export async function generateQuiz(lines, struggledLines, settings) {
  const client = getClient(settings);
  const { target, native } = names(settings);
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(QuizSchema) },
    system:
      `You are a ${target} teacher. Your learner's native language is ${native} and their ${target} ` +
      `level is ${settings.level} (CEFR). You get the ${target} transcript of a video they just watched; ` +
      "it may come from automatic speech recognition and contain errors, so skip garbled parts and never " +
      `ask about details you are unsure of. Write 6 multiple-choice questions in ${target}, worded for ` +
      `their level: 3 'comprehension' (what happened or was said), 2 'vocabulary' (meaning of a word or ` +
      "phrase in its context), 1 'listening' (a quote with one key word replaced by ____, choose the " +
      "missing word). Each question has exactly 4 options and one correct answer; correct_index is 0-3 and " +
      "the correct position varies between questions. quote is the transcript line the question is based " +
      `on. explanation explains the answer in ${native} in one or two sentences. If the learner needed ` +
      "help with some lines, base the vocabulary questions on those lines.",
    messages: [
      {
        role: "user",
        content:
          `Transcript:\n${lines.join("\n")}\n\n` +
          `Lines the learner needed help with:\n${struggledLines.length ? struggledLines.join("\n") : "(none)"}`,
      },
    ],
  });
  const quiz = parsedOrThrow(response);
  quiz.questions = quiz.questions.filter(
    (q) => q.options.length >= 2 && q.correct_index >= 0 && q.correct_index < q.options.length
  );
  if (!quiz.questions.length) throw new Error(t("errQuizEmpty"));
  quiz.lang = baseLang(settings.targetLang);
  return quiz;
}
