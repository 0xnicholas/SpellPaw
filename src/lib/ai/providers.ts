// AI provider clients (BYOK — ADR-0005). Plain fetch, no SDK: both OpenAI and
// Anthropic are single HTTPS JSON calls, and fetch keeps the dependency tree
// small. Error codes follow the spec §8 taxonomy: MODEL_KEY_INVALID (401/403),
// MODEL_KEY_QUOTA (429), AI_PROVIDER_ERROR (everything else).
//
// M7-B: the general-purpose `complete()` primitive is the single chat-completion
// entry point. `generateContent` (Composer rewrite) is now a thin wrapper over
// it; M7-C Persona derivation will call `complete({ json: true })` directly.

export type AiProvider = "openai" | "anthropic";

export type AiErrorCode = "MODEL_KEY_INVALID" | "MODEL_KEY_QUOTA" | "AI_PROVIDER_ERROR";

export class AiProviderError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export const AI_PROVIDERS: readonly AiProvider[] = ["openai", "anthropic"];

const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-3-5-haiku-latest";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 1024;

export interface CompleteOptions {
  provider: AiProvider;
  apiKey: string;
  /** System/instruction prompt. Empty = omitted (no system message). */
  system: string;
  /** User turn content (the task input). */
  user: string;
  /** Request structured JSON output (OpenAI response_format; Anthropic prompt). */
  json?: boolean;
  /** Override the default per-provider model. */
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
}

const JSON_INSTRUCTION =
  "Respond with ONLY valid minified JSON, no prose, no markdown fences.";

function mapHttpError(status: number, provider: AiProvider): AiProviderError {
  if (status === 401 || status === 403) {
    return new AiProviderError("MODEL_KEY_INVALID", `${provider} rejected the API key (HTTP ${status})`);
  }
  if (status === 429) {
    return new AiProviderError("MODEL_KEY_QUOTA", `${provider} rate-limited or out of quota (HTTP 429)`);
  }
  return new AiProviderError("AI_PROVIDER_ERROR", `${provider} returned HTTP ${status}`);
}

/**
 * General chat completion. Returns the provider's text response (trimmed).
 * When `json` is set, OpenAI uses response_format and Anthropic gets a JSON-only
 * instruction appended — parse the result with {@link parseJsonLenient}.
 * Throws AiProviderError on any failure (auth, quota, timeout, network).
 */
export async function complete(opts: CompleteOptions): Promise<string> {
  const provider = opts.provider;
  const model = opts.model ?? (provider === "openai" ? OPENAI_MODEL : ANTHROPIC_MODEL);
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  // Anthropic has no native JSON mode — coerce via the system prompt.
  const system =
    opts.json && provider === "anthropic" && !opts.system.includes(JSON_INSTRUCTION)
      ? `${opts.system}\n\n${JSON_INSTRUCTION}`.trim()
      : opts.system;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: opts.user },
          ],
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!res.ok) throw mapHttpError(res.status, provider);
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      return (data.choices?.[0]?.message?.content ?? "").trim();
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: opts.user }],
      }),
    });
    if (!res.ok) throw mapHttpError(res.status, provider);
    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    return (data.content?.find((b) => b.type === "text")?.text ?? "").trim();
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new AiProviderError("AI_PROVIDER_ERROR", "provider request timed out");
    }
    throw new AiProviderError("AI_PROVIDER_ERROR", `provider request failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Leniently extract + parse JSON from an LLM response: strips markdown fences
 * and surrounding prose, isolating the outermost object/array. Use after
 * `complete({ json: true })`. Throws AiProviderError(AI_PROVIDER_ERROR) if the
 * response cannot be parsed.
 */
export function parseJsonLenient<T = unknown>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Fall back to the outermost {...} or [...] span if prose wraps the JSON.
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        /* fall through to error */
      }
    }
    throw new AiProviderError(
      "AI_PROVIDER_ERROR",
      `could not parse JSON from provider response: ${trimmed.slice(0, 120)}`,
    );
  }
}

// --- Composer rewrite (M3) — thin wrapper over complete() ------------------

export interface GenerateOptions {
  provider: AiProvider;
  apiKey: string;
  /** Source text to rewrite (Composer AI button). */
  text: string;
  /** Target channel slug (twitter/linkedin/instagram) — shapes the rewrite. */
  channelSlug?: string;
}

const CHANNEL_GUIDANCE: Record<string, string> = {
  twitter: "a concise X/Twitter post (fits within 280 characters), with a punchy hook",
  linkedin: "a professional LinkedIn post, conversational but polished, ending with a light question",
  instagram: "an Instagram caption, friendly and visual, with a few relevant hashtags at the end",
};

/** Calls the provider and returns the rewritten text. Throws AiProviderError. */
export async function generateContent(opts: GenerateOptions): Promise<string> {
  const guidance = opts.channelSlug ? CHANNEL_GUIDANCE[opts.channelSlug] : "a social media post";
  // Keep the Composer prompt as a single user turn (system empty) to preserve
  // the original request shape; complete() omits an empty system message.
  return complete({
    provider: opts.provider,
    apiKey: opts.apiKey,
    system: "",
    user: [
      "You are a social media copywriter. Rewrite the source text below as",
      `${guidance}. Keep the core message and tone; do not invent facts.`,
      "Return only the rewritten text, no commentary or quotes.",
      "",
      "SOURCE:",
      opts.text,
    ].join("\n"),
    maxTokens: 500,
  });
}

/** Human-readable key preview, e.g. "sk-…a1b2" (never the full key). */
export function keyPreview(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}
