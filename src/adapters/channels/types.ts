// Channel adapter contract — one adapter per platform (ADR-0004, "Adapter pattern").
// Adapt a platform by implementing this interface; register it in ./registry.

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

export interface PublishResult {
  /** Platform-side id of the published content. */
  externalId: string;
}

export interface ChannelAdapter {
  readonly slug: string;

  /** OAuth2 authorization URL for the "connect" step. */
  buildAuthUrl(state: string, redirectUri: string, codeChallenge: string): string;

  /** Exchange the authorization code for a token set (PKCE). */
  exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<TokenSet>;

  /** Publish variant content to the platform. */
  publish(content: string, tokens: TokenSet): Promise<PublishResult>;
}
