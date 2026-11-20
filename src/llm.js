// AI calls for line translations and quizzes, for any learning/native language pair and any provider.
// Anthropic goes through its SDK; every other provider through the OpenAI-compatible chat API.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import "../extension/settings.js";

const { t, languageName, baseLang, PROVIDERS } = globalThis.Kavra;

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

async function anthropicJSON(settings, { system, user, schema, maxTokens, effort }) {
  const response = await anthropicClient(settings.key).messages.parse({
    model: settings.model,
    max_tokens: maxTokens,
    // effort is set for the default model only; older Claude models reject it.
    output_config: {
      format: zodOutputFormat(schema),
      ...(settings.model === PROVIDERS.anthropic.model ? { effort } : {}),
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

export function translateLine(line, context, settings) {
  const { target, native } = names(settings);
  return generateJSON(settings, {
    schema: TranslationSchema,
    maxTokens: 4000,
    effort: "low",
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
    user: `Preceding lines (context only):\n${context || "(none)"}\n\nLine to translate:\n${line}`,
  });
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
  quiz.questions = quiz.questions.filter(
    (q) => q.options.length >= 2 && q.correct_index >= 0 && q.correct_index < q.options.length
  );
  if (!quiz.questions.length) throw new Error(t("errQuizEmpty"));
  quiz.lang = baseLang(settings.targetLang);
  return quiz;
}
