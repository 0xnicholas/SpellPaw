// AES-256-GCM at-rest encryption for OAuth tokens and other secrets.
// Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const VERSION = "v1";
const IV_LENGTH = 12;

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
  tag: string;
}

export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptString(plaintext: string, key: Buffer): string {
  const payload = encrypt(plaintext, key);
  return `${VERSION}:${payload.iv}:${payload.tag}:${payload.ciphertext}`;
}

export function decryptString(stored: string, key: Buffer): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("invalid encrypted payload");
  }
  return decrypt({ iv: parts[1], tag: parts[2], ciphertext: parts[3] }, key);
}

/** Loads the AES key from ENCRYPTION_KEY (base64, 32 bytes). */
export function getEncryptionKey(): Buffer {
  const b64 = process.env.ENCRYPTION_KEY;
  if (!b64) throw new Error("ENCRYPTION_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}
