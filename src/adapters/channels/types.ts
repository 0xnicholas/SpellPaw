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

/** Platform thread reference for replying to an inbound message (M6). */
export interface ReplyTarget {
  /** Platform id of the message being replied to (e.g. tweet id on X). */
  externalId: string;
  /** Platform id of the originating post when the thread is a comment chain. */
  postExternalId?: string | null;
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
   * OPTIONAL: reply to an inbound message in a 1:1 thread (M6). Absent = no
   * reply support (replies fail as permanent on that channel). Real platforms
   * implement it (X: POST /2/tweets with in_reply_to_tweet_id once approved);
   * MockAdapter records the reply locally.
   */
  reply?(target: ReplyTarget, content: string, tokens: TokenSet): Promise<PublishResult>;

  /**
   * OPTIONAL capability (MockAdapter, dev/test only): when true, the queue
   * layer schedules a simulated inbound message shortly after each successful
   * publish (ADR-0013 — mock-first inbound pipeline). Real adapters omit it;
   * their inbound arrives via fetchInbound() polling once implemented.
   */
  readonly simulatesInbound?: boolean;
}
