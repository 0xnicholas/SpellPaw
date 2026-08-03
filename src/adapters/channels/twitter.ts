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
const SCOPE = "tweet.read tweet.write users.read offline.access";

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
      const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
      const res = await doFetch(TOKEN_URL, {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
      });
      const json = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };
      if (!res.ok || !json.access_token) {
        throw new Error(
          `Twitter OAuth token exchange failed: ${json.error_description ?? json.error ?? res.status}`,
        );
      }
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? null,
        expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
      };
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
