import { describe, expect, it } from "vitest";
import { computeCodeChallenge, generatePkceVerifier } from "./pkce";

describe("generatePkceVerifier", () => {
  it("is unique per call", () => {
    expect(generatePkceVerifier()).not.toBe(generatePkceVerifier());
  });

  it("is URL-safe and within the PKCE length spec (43–128)", () => {
    for (let i = 0; i < 20; i++) {
      const v = generatePkceVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9\-_.~]+$/);
    }
  });
});

describe("computeCodeChallenge", () => {
  it("is deterministic for the same verifier", () => {
    const v = generatePkceVerifier();
    expect(computeCodeChallenge(v)).toBe(computeCodeChallenge(v));
  });

  it("produces a base64url SHA-256 (43 chars, no padding)", () => {
    const challenge = computeCodeChallenge(generatePkceVerifier());
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]{43}$/);
  });

  it("differs across verifiers", () => {
    const a = computeCodeChallenge("verifier-one-abcdefghijklmnop");
    const b = computeCodeChallenge("verifier-two-abcdefghijklmnop");
    expect(a).not.toBe(b);
  });
});
