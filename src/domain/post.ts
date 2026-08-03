// Post domain — pure functions, no I/O. The single source of truth for
// status transitions, per-channel validation, and scheduling rules.

export type PostStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED";
export type PublishState = "DRAFT" | "PUBLISHED" | "FAILED";

export interface PostVariantLike {
  publishState: PublishState;
  publishedAt?: Date | null;
  errorMessage?: string | null;
}

export interface PostLike {
  scheduledAt?: Date | null;
  publishedAt?: Date | null;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/** Character limits per channel slug (used by the Composer counter + publish guard). */
export const CHANNEL_CHAR_LIMITS: Record<string, number> = {
  twitter: 280,
  linkedin: 3000,
  instagram: 2200,
};

const DEFAULT_CHAR_LIMIT = 5000;

export function getChannelCharLimit(channelSlug: string): number {
  return CHANNEL_CHAR_LIMITS[channelSlug] ?? DEFAULT_CHAR_LIMIT;
}

export function validateVariantContent(channelSlug: string, content: string): ValidationResult {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "content is empty" };
  }
  const limit = getChannelCharLimit(channelSlug);
  if (trimmed.length > limit) {
    return { ok: false, reason: `content exceeds ${limit} characters (${trimmed.length})` };
  }
  return { ok: true };
}

export function markVariantPublished(
  publishedAt: Date,
): Pick<PostVariantLike, "publishState" | "publishedAt" | "errorMessage"> {
  // A successful publish also clears any stale failure message (retry path).
  return { publishState: "PUBLISHED", publishedAt, errorMessage: null };
}

export function markVariantFailed(
  errorMessage: string,
): Pick<PostVariantLike, "publishState" | "errorMessage"> {
  return { publishState: "FAILED", errorMessage };
}

export function validateSchedule(scheduledAt: Date, now: Date = new Date()): ValidationResult {
  if (scheduledAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "scheduledAt must be in the future" };
  }
  return { ok: true };
}

/** Post-level status derived from schedule/publish state. */
export function derivePostStatus(post: PostLike): PostStatus {
  if (post.publishedAt) return "PUBLISHED";
  if (post.scheduledAt) return "SCHEDULED";
  return "DRAFT";
}
