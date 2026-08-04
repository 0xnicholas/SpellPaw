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

  /**
   * OPTIONAL: rotate an expired token set (platforms with offline access).
   * Implementations must throw on an invalid/revoked refresh token so the
   * caller can surface a clear permanent failure. Absent = no refresh support
   * (mock adapters, platforms without refresh tokens).
   */
  refresh?(tokens: TokenSet): Promise<TokenSet>;

  /**
   * OPTIONAL: the human-readable account name shown for a connection
   * (e.g. "@handle" on X). Absent = the channel's static name is shown.
   */
  fetchAccountName?(tokens: TokenSet): Promise<string | null>;

  /**
   * OPTIONAL capability (MockAdapter, dev/test only): when true, the queue
   * layer schedules a simulated inbound message shortly after each successful
   * publish (ADR-0013 — mock-first inbound pipeline). Real adapters omit it;
   * their inbound arrives via fetchInbound() polling once implemented.
   */
  readonly simulatesInbound?: boolean;
}
