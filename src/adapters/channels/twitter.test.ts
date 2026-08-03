import { describe, expect, it, vi } from "vitest";
import { createTwitterAdapter } from "./twitter";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CLIENT = {
  clientId: "client-123",
  clientSecret: "secret-456",
  redirectUri: "http://localhost:3000/api/channels/twitter/callback",
};

describe("TwitterAdapter.buildAuthUrl", () => {
  const adapter = createTwitterAdapter(CLIENT);
  const url = adapter.buildAuthUrl("state-abc", CLIENT.redirectUri, "challenge-xyz");

  it("points at the Twitter authorize endpoint", () => {
    expect(url.startsWith("https://twitter.com/i/oauth2/authorize")).toBe(true);
  });

  it("carries client id, redirect, state, PKCE challenge and write scope", () => {
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("client-123");
    expect(params.get("redirect_uri")).toBe(CLIENT.redirectUri);
    expect(params.get("state")).toBe("state-abc");
    expect(params.get("code_challenge")).toBe("challenge-xyz");
    expect(params.get("code_challenge_method")).toBe("S256");
    const scope = params.get("scope")?.split(" ") ?? [];
    expect(scope).toContain("tweet.write");
    expect(scope).toContain("offline.access");
  });
});

describe("TwitterAdapter.exchangeCode", () => {
  it("posts the code + PKCE verifier and returns a token set", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.twitter.com/2/oauth2/token");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("code-1");
      expect(body.get("redirect_uri")).toBe(CLIENT.redirectUri);
      expect(body.get("code_verifier")).toBe("verifier-1");
      const auth = String(init?.headers ? (init.headers as Record<string, string>)["authorization"] : "");
      expect(auth.startsWith("Basic ")).toBe(true);
      return jsonResponse({
        token_type: "bearer",
        expires_in: 7200,
        access_token: "at-1",
        refresh_token: "rt-1",
      });
    });

    const adapter = createTwitterAdapter({ ...CLIENT, fetchImpl: fetchMock });
    const tokens = await adapter.exchangeCode("code-1", CLIENT.redirectUri, "verifier-1");

    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.refreshToken).toBe("rt-1");
    expect(tokens.expiresAt?.getTime()).toBeCloseTo(Date.now() + 7200_000, -3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a descriptive error on an OAuth error response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "invalid_grant" }, 400));
    const adapter = createTwitterAdapter({ ...CLIENT, fetchImpl: fetchMock });
    await expect(adapter.exchangeCode("bad", CLIENT.redirectUri, "v")).rejects.toThrow(/invalid_grant/);
  });
});

describe("TwitterAdapter.publish", () => {
  it("POSTs the content as a tweet with the bearer token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.twitter.com/2/tweets");
      const headers = init?.headers as Record<string, string>;
      expect(headers["authorization"]).toBe("Bearer at-1");
      expect(JSON.parse(String(init?.body))).toEqual({ text: "hello world" });
      return jsonResponse({ data: { id: "tweet-42" } });
    });

    const adapter = createTwitterAdapter({ ...CLIENT, fetchImpl: fetchMock });
    const result = await adapter.publish("hello world", { accessToken: "at-1" });
    expect(result.externalId).toBe("tweet-42");
  });

  it("throws when the API reports an error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ errors: [{ message: "duplicate content" }] }, 403),
    );
    const adapter = createTwitterAdapter({ ...CLIENT, fetchImpl: fetchMock });
    await expect(adapter.publish("x", { accessToken: "at" })).rejects.toThrow(/duplicate content/);
  });
});
