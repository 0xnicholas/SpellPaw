// Unit tests for the BYOK provider clients — fetch is stubbed, no network.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateContent,
  keyPreview,
} from "./providers";

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("generateContent", () => {
  it("calls OpenAI chat completions with the API key and returns the text", async () => {
    stubFetch(async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer sk-test-1234");
      expect(JSON.parse(String(init.body)).model).toBe("gpt-4o-mini");
      return new Response(JSON.stringify({ choices: [{ message: { content: "  rewritten post  " } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const text = await generateContent({ provider: "openai", apiKey: "sk-test-1234", text: "src", channelSlug: "twitter" });
    expect(text).toBe("rewritten post");
  });

  it("calls Anthropic messages with x-api-key + version header", async () => {
    stubFetch(async (url, init) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      const headers = init.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-xyz");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      return new Response(JSON.stringify({ content: [{ type: "text", text: "anthropic rewrite" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const text = await generateContent({ provider: "anthropic", apiKey: "sk-ant-xyz", text: "src" });
    expect(text).toBe("anthropic rewrite");
  });

  it("maps 401 to MODEL_KEY_INVALID", async () => {
    stubFetch(async () => new Response("bad key", { status: 401 }));
    await expect(
      generateContent({ provider: "openai", apiKey: "sk-bad", text: "x" }),
    ).rejects.toMatchObject({ code: "MODEL_KEY_INVALID" });
  });

  it("maps 429 to MODEL_KEY_QUOTA", async () => {
    stubFetch(async () => new Response("rate limited", { status: 429 }));
    await expect(
      generateContent({ provider: "anthropic", apiKey: "sk-ant-x", text: "x" }),
    ).rejects.toMatchObject({ code: "MODEL_KEY_QUOTA" });
  });

  it("maps other statuses to AI_PROVIDER_ERROR", async () => {
    stubFetch(async () => new Response("boom", { status: 500 }));
    await expect(
      generateContent({ provider: "openai", apiKey: "sk-x", text: "x" }),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
  });

  it("maps network failure to AI_PROVIDER_ERROR", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      generateContent({ provider: "openai", apiKey: "sk-x", text: "x" }),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
  });

  it("times out after 30s", async () => {
    vi.useFakeTimers();
    stubFetch(async (_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const pending = generateContent({ provider: "openai", apiKey: "sk-x", text: "x" });
    pending.catch(() => {}); // expected rejection — asserted below
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(pending).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
  });
});

describe("keyPreview", () => {
  it("shows prefix + last 4 chars", () => {
    expect(keyPreview("sk-abcdef123456")).toBe("sk-…3456");
  });

  it("masks short keys entirely", () => {
    expect(keyPreview("short")).toBe("•••••");
  });
});
