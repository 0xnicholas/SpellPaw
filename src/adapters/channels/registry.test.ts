import { describe, expect, it, vi } from "vitest";
import { getAdapter } from "./registry";
import { MockAdapter } from "./mock";

describe("adapter registry", () => {
  it("returns a MockAdapter for unconfigured channels", () => {
    vi.stubEnv("TWITTER_CLIENT_ID", "");
    expect(getAdapter("twitter")).toBeInstanceOf(MockAdapter);
    expect(getAdapter("linkedin")).toBeInstanceOf(MockAdapter);
    expect(getAdapter("instagram")).toBeInstanceOf(MockAdapter);
    vi.unstubAllEnvs();
  });

  it("returns the real TwitterAdapter when credentials are configured", () => {
    vi.stubEnv("TWITTER_CLIENT_ID", "cid");
    vi.stubEnv("TWITTER_CLIENT_SECRET", "csec");
    const adapter = getAdapter("twitter");
    expect(adapter).not.toBeInstanceOf(MockAdapter);
    expect(adapter.slug).toBe("twitter");
    vi.unstubAllEnvs();
  });

  it("falls back to the mock adapter when only partial credentials exist", () => {
    vi.stubEnv("TWITTER_CLIENT_ID", "cid");
    vi.stubEnv("TWITTER_CLIENT_SECRET", "");
    expect(getAdapter("twitter")).toBeInstanceOf(MockAdapter);
    vi.unstubAllEnvs();
  });

  it("throws for unregistered slugs", () => {
    expect(() => getAdapter("myspace")).toThrow(/no adapter/);
  });
});
