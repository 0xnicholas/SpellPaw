import { describe, expect, it } from "vitest";
import {
  CHANNEL_CHAR_LIMITS,
  derivePostStatus,
  getChannelCharLimit,
  markVariantFailed,
  markVariantPublished,
  validateSchedule,
  validateVariantContent,
} from "./post";
import type { PostStatus } from "./post";

describe("getChannelCharLimit", () => {
  it("returns the documented limit for known channels", () => {
    expect(getChannelCharLimit("twitter")).toBe(CHANNEL_CHAR_LIMITS.twitter);
    expect(getChannelCharLimit("linkedin")).toBe(CHANNEL_CHAR_LIMITS.linkedin);
    expect(getChannelCharLimit("instagram")).toBe(CHANNEL_CHAR_LIMITS.instagram);
  });

  it("falls back to a safe default for unknown channels", () => {
    expect(getChannelCharLimit("discord")).toBeGreaterThan(0);
  });
});

describe("validateVariantContent", () => {
  it("rejects empty content", () => {
    const result = validateVariantContent("twitter", "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });

  it("rejects content over the channel limit", () => {
    const result = validateVariantContent("twitter", "x".repeat(281));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("280");
  });

  it("accepts content at exactly the limit", () => {
    expect(validateVariantContent("twitter", "x".repeat(280)).ok).toBe(true);
  });

  it("accepts content within the limit", () => {
    expect(validateVariantContent("linkedin", "Hello world").ok).toBe(true);
  });
});

describe("markVariantPublished", () => {
  it("moves a variant to PUBLISHED, stamps the timestamp and clears stale errors", () => {
    const now = new Date("2026-08-03T10:00:00Z");
    const result = markVariantPublished(now);
    expect(result.publishState).toBe("PUBLISHED");
    expect(result.publishedAt).toBe(now);
    expect(result.errorMessage).toBeNull();
  });
});

describe("markVariantFailed", () => {
  it("moves a variant to FAILED and records the error", () => {
    const result = markVariantFailed("auth expired");
    expect(result.publishState).toBe("FAILED");
    expect(result.errorMessage).toBe("auth expired");
  });
});

describe("validateSchedule", () => {
  const now = new Date("2026-08-03T10:00:00Z");

  it("rejects a past timestamp", () => {
    const result = validateSchedule(new Date("2026-08-03T09:59:00Z"), now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("future");
  });

  it("accepts a future timestamp", () => {
    expect(validateSchedule(new Date("2026-08-04T10:00:00Z"), now).ok).toBe(true);
  });
});

describe("derivePostStatus", () => {
  it("starts as DRAFT with no schedule and no publish", () => {
    const status = derivePostStatus({ scheduledAt: null, publishedAt: null });
    expect(status).toBe("DRAFT");
  });

  it("is SCHEDULED once a future publish time is set", () => {
    const status = derivePostStatus({
      scheduledAt: new Date("2026-08-04T10:00:00Z"),
      publishedAt: null,
    });
    expect(status).toBe("SCHEDULED");
  });

  it("is PUBLISHED once published", () => {
    const status = derivePostStatus({
      scheduledAt: null,
      publishedAt: new Date("2026-08-03T10:00:00Z"),
    });
    expect(status).toBe("PUBLISHED");
  });

  it("types are the full Phase 1 status set", () => {
    // Compile-time sanity: PostStatus must cover Draft → Scheduled → Published.
    const all: PostStatus[] = ["DRAFT", "SCHEDULED", "PUBLISHED"];
    expect(all).toHaveLength(3);
  });
});
