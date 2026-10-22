import OpenAI from "openai";
import { z } from "zod";

export class OutputValidationError extends Error {}

export interface Usage {
  model: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number | null;
}

let client: OpenAI | undefined;
function getClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the server");
  client ??= new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    defaultHeaders: { "X-Title": "Mudita sales assistant" },
  });
  return client;
}

export function model(): string {
  return process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-5.5";
}

function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new OutputValidationError("Model did not return a JSON object");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new OutputValidationError(`Model returned malformed JSON: ${(e as Error).message}`);
  }
}

/**
 * Calls the model and validates the result against `schema` (plus optional semantic checks).
 * On a validation failure the model gets exactly one repair attempt with the errors; after that
 * the error propagates and the turn is flagged for a human, never silently accepted.
 */
export async function callJson<S extends z.ZodType>(opts: {
  model: string;
  system: string;
  user: string;
  schema: S;
  validate?: (data: z.infer<S>) => string[];
}): Promise<{ data: z.infer<S>; usage: Usage }> {
  const schemaText = JSON.stringify(z.toJSONSchema(opts.schema, { io: "input" }));
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${opts.system}\n\nRespond with a single JSON object only, no prose, matching this JSON Schema:\n${schemaText}`,
    },
    { role: "user", content: opts.user },
  ];
  const usage: Usage = { model: opts.model, calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await getClient().chat.completions.create({
      model: opts.model,
      messages,
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      usage: { include: true }, // OpenRouter extension: returns cost in usage
    } as OpenAI.ChatCompletionCreateParamsNonStreaming);

    usage.calls++;
    usage.prompt_tokens += res.usage?.prompt_tokens ?? 0;
    usage.completion_tokens += res.usage?.completion_tokens ?? 0;
    const cost = (res.usage as { cost?: number } | undefined)?.cost;
    usage.cost_usd = cost == null || usage.cost_usd == null ? null : usage.cost_usd + cost;

    const raw = res.choices[0]?.message?.content ?? "";
    let errors: string[];
    try {
      const parsed = opts.schema.safeParse(extractJson(raw));
      if (parsed.success) {
        errors = opts.validate?.(parsed.data) ?? [];
        if (errors.length === 0) return { data: parsed.data, usage };
      } else {
        errors = [z.prettifyError(parsed.error)];
      }
    } catch (e) {
      if (!(e instanceof OutputValidationError)) throw e;
      errors = [e.message];
    }

    if (attempt === 1) {
      throw new OutputValidationError(`Output failed validation after one repair attempt:\n${errors.join("\n")}`);
    }
    messages.push(
      { role: "assistant", content: raw },
      { role: "user", content: `Your output failed validation:\n${errors.join("\n")}\nReturn the corrected full JSON object.` },
    );
  }
  throw new Error("unreachable");
}
