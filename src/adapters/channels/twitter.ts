// Twitter/X adapter — OAuth 2.0 authorization code + PKCE, API v2.
import type { ChannelAdapter, PublishResult, TokenSet } from "./types";

export interface TwitterAdapterConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const TWEETS_URL = "https://api.twitter.com/2/tweets";
const USERS_ME_URL = "https://api.twitter.com/2/users/me";
const SCOPE = "tweet.read tweet.write users.read offline.access";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Shared POST to the token endpoint with Basic auth (RFC 6749 §4.1.3). */
async function tokenRequest(
  doFetch: typeof fetch,
  config: TwitterAdapterConfig,
  body: Record<string, string>,
): Promise<TokenResponse & { access_token: string }> {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await doFetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Twitter OAuth token request failed: ${json.error_description ?? json.error ?? res.status}`,
    );
  }
  return json as TokenResponse & { access_token: string };
}
export function createTwitterAdapter(config: TwitterAdapterConfig): ChannelAdapter {
  const doFetch = config.fetchImpl ?? globalThis.fetch;

  return {
    slug: "twitter",

    buildAuthUrl(state: string, redirectUri: string, codeChallenge: string): string {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return `${AUTHORIZE_URL}?${params.toString()}`;
    },

    async exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<TokenSet> {
      const json = await tokenRequest(doFetch, config, {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? null,
        expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
      };
    },

    async refresh(tokens: TokenSet): Promise<TokenSet> {
      if (!tokens.refreshToken) {
        throw new Error("Twitter refresh failed: no refresh token stored");
      }
      const json = await tokenRequest(doFetch, config, {
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      });
      // Twitter rotates refresh tokens; keep the newest one for the next round.
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? tokens.refreshToken,
        expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
      };
    },

    async fetchAccountName(tokens: TokenSet): Promise<string | null> {
      const res = await doFetch(USERS_ME_URL, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { username?: string };
        errors?: Array<{ message?: string }>;
      };
      if (!res.ok || !json.data?.username) {
        // Cosmetic — a failed name fetch must not fail the connection.
        return null;
      }
      return `@${json.data.username}`;
    },

    async publish(content: string, tokens: TokenSet): Promise<PublishResult> {
      const res = await doFetch(TWEETS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: content }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { id?: string };
        errors?: Array<{ message?: string }>;
      };
      if (!res.ok) {
        const detail = json.errors
          ?.map((e) => e.message)
          .filter(Boolean)
          .join("; ");
        throw new Error(`Twitter publish failed: ${detail ?? res.status}`);
      }
      return { externalId: String(json.data?.id) };
    },
  };
}
