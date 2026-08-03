import { describe, expect, it } from "vitest";
import { decrypt, decryptString, encrypt, encryptString } from "./crypto";

const KEY = Buffer.from("k".repeat(32), "utf8"); // 32-byte key

describe("AES-256-GCM encrypt/decrypt", () => {
  it("round-trips a plaintext", () => {
    const payload = encrypt("super-secret-token", KEY);
    expect(decrypt(payload, KEY)).toBe("super-secret-token");
  });

  it("uses a random IV — same plaintext encrypts differently", () => {
    const a = encrypt("same", KEY);
    const b = encrypt("same", KEY);
    expect(a).not.toBe(b);
  });

  it("round-trips via the string helpers", () => {
    const stored = encryptString("t0ken", KEY);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptString(stored, KEY)).toBe("t0ken");
  });

  it("fails to decrypt with a different key", () => {
    const payload = encrypt("secret", KEY);
    const wrongKey = Buffer.from("x".repeat(32), "utf8");
    expect(() => decrypt(payload, wrongKey)).toThrow();
  });

  it("fails on tampered ciphertext", () => {
    const stored = encryptString("secret", KEY);
    const tampered = stored.slice(0, -2) + (stored.endsWith("==") ? "AA" : "ab");
    expect(() => decryptString(tampered, KEY)).toThrow();
  });

  it("throws on malformed payload", () => {
    expect(() => decryptString("not-a-valid-payload", KEY)).toThrow();
  });
});
