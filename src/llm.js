// AI calls for line translations and quizzes, for any learning/native language pair and any provider.
// Anthropic goes through its SDK; every other provider through the OpenAI-compatible chat API.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import "../extension/settings.js";

const { t, languageName, baseLang, PROVIDERS } = globalThis.Kavra;

const LiveTranslationSchema = z.object({
  translation: z.string(),
  pairs: z.array(z.object({ original: z.string(), translated: z.string() })),
});
const TranslationSchema = LiveTranslationSchema.extend({
  notes: z.array(z.object({ phrase: z.string(), meaning: z.string() })),
});
const BatchSchema = z.object({ items: z.array(LiveTranslationSchema) });

const question = (kinds) =>
  z.object({
    kind: z.enum(kinds),
    question: z.string(),
    quote: z.string(),
    options: z.array(z.string()),
    correct_index: z.number().int(),
    explanation: z.string(),
  });
const QuizSchema = z.object({ questions: z.array(question(["comprehension", "vocabulary", "listening"])) });
const WordQuizSchema = z.object({ questions: z.array(question(["vocabulary", "fill", "translation"])) });

// An HTTP failure from an OpenAI-compatible provider; status 0 means the request never got an answer.
class ProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return t("errBadKey");
  if (err instanceof Anthropic.PermissionDeniedError) return t("errPermission");
  if (err instanceof Anthropic.NotFoundError) return t("errModel", err.message);
  if (err instanceof Anthropic.RateLimitError) return t("errRateLimit");
  if (err instanceof Anthropic.APIConnectionError) return t("errConnection");
  if (err instanceof Anthropic.APIError) return t("errApi", err.status, err.message);
  if (err instanceof ProviderError) {
    if (err.status === 0) return t("errConnection");
    if (err.status === 401) return t("errBadKey");
    if (err.status === 403) return t("errPermission");
    if (err.status === 404) return t("errModel", err.message);
    if (err.status === 429) return t("errRateLimit");
    return t("errApi", err.status, err.message);
  }
  return err?.message || String(err);
}

// ---- Anthropic ----
function anthropicClient(key) {
  // The key lives only in this extension's local storage and is sent only to the provider's API.
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}

async function anthropicJSON(settings, { system, user, schema, maxTokens, effort, think = true }) {
  // effort and turning thinking off are set for the default model only; other Claude models differ.
  const tuned = settings.model === PROVIDERS.anthropic.model;
  const response = await anthropicClient(settings.key).messages.parse({
    model: settings.model,
    max_tokens: maxTokens,
    ...(tuned && !think ? { thinking: { type: "disabled" } } : {}),
    output_config: {
      format: zodOutputFormat(schema),
      ...(tuned ? { effort } : {}),
    },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") throw new Error(t("errRefusal"));
  if (response.stop_reason === "max_tokens") throw new Error(t("errTruncated"));
  if (!response.parsed_output) throw new Error(t("errUnreadable"));
  return response.parsed_output;
}

// ---- OpenAI-compatible providers ----
async function request(settings, path, body) {
  const provider = PROVIDERS[settings.provider];
  let res;
  try {
    res = await fetch(`${provider.base}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${settings.key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(settings.provider === "openrouter" ? { "X-Title": "Kavra" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ProviderError(0, err.message);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = Array.isArray(data) ? data[0]?.error : data?.error; // Gemini can wrap errors in an array
    throw new ProviderError(res.status, error?.message || res.statusText);
  }
  return data;
}

function parseJSON(text, schema) {
  const json = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""); // some models wrap JSON in a code fence
  return schema.parse(JSON.parse(json));
}

async function compatibleJSON(settings, { system, user, schema }) {
  const messages = [
    {
      role: "system",
      content:
        `${system}\n\nReply with one JSON object that matches this JSON Schema and nothing else:\n` +
        JSON.stringify(z.toJSONSchema(schema)),
    },
    { role: "user", content: user },
  ];
  // One retry with the model's own answer in view if it isn't valid JSON for the schema.
  for (let attempt = 0; ; attempt++) {
    const data = await request(settings, "/chat/completions", {
      model: settings.model,
      messages,
      response_format: { type: "json_object" },
    });
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === "content_filter") throw new Error(t("errRefusal"));
    const text = choice?.message?.content ?? "";
    try {
      return parseJSON(text, schema);
    } catch {
      if (choice?.finish_reason === "length") throw new Error(t("errTruncated"));
      if (attempt >= 1) throw new Error(t("errUnreadable"));
      messages.push(
        { role: "assistant", content: text },
        { role: "user", content: "That was not a valid JSON object for the schema. Reply again with only the corrected JSON." }
      );
    }
  }
}

function generateJSON(settings, args) {
  if (!settings.key) throw new Error(t("errNoKey"));
  return settings.provider === "anthropic" ? anthropicJSON(settings, args) : compatibleJSON(settings, args);
}

export async function listModels(settings) {
  if (!settings.key) throw new Error(t("errNoKey"));
  if (settings.provider === "anthropic") {
    const ids = [];
    for await (const model of anthropicClient(settings.key).models.list()) ids.push(model.id);
    return ids;
  }
  const data = await request(settings, "/models");
  return (data?.data || []).map((m) => String(m.id).replace(/^models\//, "")).sort();
}

// ---- prompts ----
function names(settings) {
  return { target: languageName(settings.targetLang), native: languageName(settings.nativeLang) };
}

function translationSystem(settings, { withNotes = false, batch = false } = {}) {
  const { target, native } = names(settings);
  return (
    `You help a learner whose native language is ${native} learn ${target} from videos. The ${target} ` +
    "text comes from video subtitles or automatic speech recognition, so it may lack punctuation or " +
    `contain small mistakes; translate what was most likely said. Give a natural ${native} translation ` +
    (batch
      ? "of each numbered line on its own. items has exactly one entry per line, in the same order.\n"
      : "of the line.\n") +
    "pairs: split the line into 2-6 meaningful chunks (phrases, not lone articles or fillers) and give " +
    "the matching chunk of your translation for each, so the learner can see which part means what. " +
    "original must be copied exactly from the line and translated exactly from your translation; chunks " +
    "must not overlap. A one- or two-word line may have a single pair." +
    (withNotes
      ? "\nnotes: up to 3 idioms, phrasal verbs, slang or less common words from the line, each with its " +
        `meaning in this context written in ${native}. Leave notes empty if the line is simple.`
      : "")
  );
}

// Live lines skip the notes and the model's thinking: a plain translation is quick, cheap work.
export function translateLine(line, context, settings, { withNotes = false } = {}) {
  return generateJSON(settings, {
    schema: withNotes ? TranslationSchema : LiveTranslationSchema,
    maxTokens: withNotes ? 2000 : 1000,
    effort: "low",
    think: false,
    system: translationSystem(settings, { withNotes }),
    user: `Preceding lines (context only):\n${context || "(none)"}\n\nLine to translate:\n${line}`,
  });
}

// Several upcoming lines in one request, so the instructions are sent once for all of them.
export async function translateBatch(lines, context, settings) {
  const { items } = await generateJSON(settings, {
    schema: BatchSchema,
    maxTokens: 1000 + 400 * lines.length,
    effort: "low",
    think: false,
    system: translationSystem(settings, { batch: true }),
    user:
      `Preceding lines (context only):\n${context || "(none)"}\n\n` +
      `Lines to translate:\n${lines.map((line, i) => `${i + 1}. ${line}`).join("\n")}`,
  });
  if (items.length !== lines.length) throw new Error(t("errUnreadable"));
  return items;
}

export async function generateQuiz(lines, struggledLines, settings) {
  const { target, native } = names(settings);
  const quiz = await generateJSON(settings, {
    schema: QuizSchema,
    maxTokens: 16000,
    effort: "medium",
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
    user:
      `Transcript:\n${lines.join("\n")}\n\n` +
      `Lines the learner needed help with:\n${struggledLines.length ? struggledLines.join("\n") : "(none)"}`,
  });
  return checkedQuiz(quiz, settings);
}

// Review questions on lines saved to the word pool, with the translation and notes saved for each.
export async function generateWordQuiz(words, settings) {
  const { target, native } = names(settings);
  const count = Math.min(8, words.length);
  const quiz = await generateJSON(settings, {
    schema: WordQuizSchema,
    maxTokens: 16000,
    effort: "medium",
    system:
      `You are a ${target} teacher. Your learner's native language is ${native} and their ${target} ` +
      `level is ${settings.level} (CEFR). While watching videos they saved the ${target} lines below to ` +
      `review later, each with its ${native} translation and notes on harder words. Write ${count} ` +
      `multiple-choice review questions in ${target}, worded for their level, each on a different line ` +
      "and mixing three kinds: 'vocabulary' (the meaning of a word or phrase from the line, as used " +
      "there; prefer the noted phrases), 'fill' (the line with one key word or phrase replaced by ____, " +
      `choose the missing part) and 'translation' (give the ${native} translation in quotes and ask which ` +
      `${target} sentence says it; the wrong options differ in meaning, not just in small details). Each ` +
      "question has exactly 4 options and one correct answer; correct_index is 0-3 and the correct " +
      "position varies between questions. quote is the saved line the question is based on. explanation " +
      `explains the answer in ${native} in one or two sentences.`,
    user: words
      .map((w, i) => {
        const notes = (w.notes || []).map((n) => `${n.phrase}: ${n.meaning}`).join("; ");
        return `${i + 1}. ${w.text}\n   ${native}: ${w.translation}${notes ? `\n   notes: ${notes}` : ""}`;
      })
      .join("\n"),
  });
  return checkedQuiz(quiz, settings);
}

// Keeps the questions with a usable answer and tags the quiz with the language it's in.
function checkedQuiz(quiz, settings) {
  quiz.questions = quiz.questions.filter(
    (q) => q.options.length >= 2 && q.correct_index >= 0 && q.correct_index < q.options.length
  );
  if (!quiz.questions.length) throw new Error(t("errQuizEmpty"));
  quiz.lang = baseLang(settings.targetLang);
  return quiz;
}
