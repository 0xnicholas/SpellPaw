// PKCE helpers for the channel OAuth flows (RFC 7636).
import { createHash, randomBytes } from "node:crypto";

/** 64-char URL-safe verifier (within the 43–128 spec range). */
export function generatePkceVerifier(): string {
  return randomBytes(48).toString("base64url");
}

/** S256 code challenge for a verifier. */
export function computeCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
