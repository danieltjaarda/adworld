import "server-only";

import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";

import { getEnv } from "@/lib/env";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------

function secretBase(): string {
  const env = getEnv();
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  if (env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set in production.");
  }
  // Development fallback so a fresh clone boots; never used in production.
  return "development-only-insecure-secret-change-me";
}

function decodeKey(raw: string): Buffer | null {
  const hex = /^[0-9a-fA-F]{64}$/;
  if (hex.test(raw)) return Buffer.from(raw, "hex");
  try {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  } catch {
    /* fall through */
  }
  return null;
}

let encryptionKey: Buffer | null = null;

/** 32-byte AES key: explicit ENCRYPTION_KEY when provided, otherwise HKDF(AUTH_SECRET). */
function getEncryptionKey(): Buffer {
  if (encryptionKey) return encryptionKey;
  const configured = getEnv().ENCRYPTION_KEY;
  if (configured) {
    const decoded = decodeKey(configured);
    if (!decoded) {
      throw new Error("ENCRYPTION_KEY must be 32 bytes encoded as hex or base64.");
    }
    encryptionKey = decoded;
    return encryptionKey;
  }
  encryptionKey = Buffer.from(
    hkdfSync("sha256", Buffer.from(secretBase()), Buffer.alloc(0), "adleverage:token-encryption", 32),
  );
  return encryptionKey;
}

/** Test helper: forget derived key material after mutating process.env. */
export function resetKeyCache(): void {
  encryptionKey = null;
}

// ---------------------------------------------------------------------------
// Symmetric encryption for OAuth tokens at rest (AES-256-GCM)
// ---------------------------------------------------------------------------

const ENCRYPTION_VERSION = "v1";

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, ivPart, dataPart, tagPart] = payload.split(".");
  if (version !== ENCRYPTION_VERSION || !ivPart || !dataPart || !tagPart) {
    throw new Error("Malformed encrypted payload.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt — no native modules, works on every Vercel runtime)
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;
const SCRYPT_PREFIX = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, SCRYPT_KEYLEN);
  return [SCRYPT_PREFIX, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltPart, hashPart] = stored.split("$");
  if (scheme !== SCRYPT_PREFIX || !saltPart || !hashPart) return false;
  const expected = Buffer.from(hashPart, "base64url");
  const derived = await scrypt(
    password.normalize("NFKC"),
    Buffer.from(saltPart, "base64url"),
    expected.length,
  );
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// ---------------------------------------------------------------------------
// Opaque tokens (sessions, email verification, password reset, invitations)
// ---------------------------------------------------------------------------

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored hashed so a database dump cannot be replayed. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function signPayload(value: string): string {
  return createHmac("sha256", secretBase()).update(value).digest("base64url");
}

export function verifySignature(value: string, signature: string): boolean {
  return constantTimeEquals(signPayload(value), signature);
}

export function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

export function newId(): string {
  return randomUUID();
}
