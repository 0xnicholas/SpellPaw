// AI provider clients (BYOK — ADR-0005). Plain fetch, no SDK: both OpenAI and
// Anthropic are single HTTPS JSON calls, and fetch keeps the dependency tree
// small. Error codes follow the spec §8 taxonomy: MODEL_KEY_INVALID (401/403),
// MODEL_KEY_QUOTA (429), AI_PROVIDER_ERROR (everything else).

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

function buildPrompt(opts: GenerateOptions): string {
  const guidance = opts.channelSlug ? CHANNEL_GUIDANCE[opts.channelSlug] : "a social media post";
  return [
    "You are a social media copywriter. Rewrite the source text below as",
    `${guidance}. Keep the core message and tone; do not invent facts.`,
    "Return only the rewritten text, no commentary or quotes.",
    "",
    "SOURCE:",
    opts.text,
  ].join("\n");
}

function mapHttpError(status: number, provider: AiProvider): AiProviderError {
  if (status === 401 || status === 403) {
    return new AiProviderError("MODEL_KEY_INVALID", `${provider} rejected the API key (HTTP ${status})`);
  }
  if (status === 429) {
    return new AiProviderError("MODEL_KEY_QUOTA", `${provider} rate-limited or out of quota (HTTP 429)`);
  }
  return new AiProviderError("AI_PROVIDER_ERROR", `${provider} returned HTTP ${status}`);
}

/** Calls the provider and returns the rewritten text. Throws AiProviderError. */
export async function generateContent(opts: GenerateOptions): Promise<string> {
  const prompt = buildPrompt(opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    if (opts.provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 500,
        }),
      });
      if (!res.ok) throw mapHttpError(res.status, "openai");
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
        model: ANTHROPIC_MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw mapHttpError(res.status, "anthropic");
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

/** Human-readable key preview, e.g. "sk-…a1b2" (never the full key). */
export function keyPreview(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}
