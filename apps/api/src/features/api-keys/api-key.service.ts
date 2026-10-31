import { timingSafeEqual } from "node:crypto";

export interface GeneratedApiKey {
  /** The plaintext key to show the user exactly once (e.g. orch_live_abc123_xyz789) */
  plaintextKey: string;
  /** The public key identifier prefix used for indexed lookup (e.g. orch_live_abc123) */
  keyPrefix: string;
  /** SHA-256 hex hash of the complete plaintext key */
  keyHash: string;
}

/**
 * Generates a cryptographically secure API key.
 * Format: orch_live_<16_hex_public_id>_<32_hex_secret>
 */
export function generateApiKey(): GeneratedApiKey {
  const publicIdBytes = new Uint8Array(8); // 16 hex characters
  const secretBytes = new Uint8Array(16); // 32 hex characters

  crypto.getRandomValues(publicIdBytes);
  crypto.getRandomValues(secretBytes);

  const publicId = Buffer.from(publicIdBytes).toString("hex");
  const secret = Buffer.from(secretBytes).toString("hex");

  const keyPrefix = `orch_live_${publicId}`;
  const plaintextKey = `${keyPrefix}_${secret}`;
  const keyHash = hashApiKey(plaintextKey);

  return {
    plaintextKey,
    keyPrefix,
    keyHash,
  };
}

/**
 * Computes the SHA-256 hash of an API key.
 */
export function hashApiKey(plaintextKey: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(plaintextKey);
  return hasher.digest("hex");
}

/**
 * Parses the key prefix from a provided raw bearer token.
 * Returns null if the token structure does not match `orch_live_<publicId>_<secret>`.
 */
export function extractKeyPrefix(token: string): string | null {
  const trimmed = token.trim();
  const parts = trimmed.split("_");

  // Expected format: orch_live_<publicId>_<secret> -> 4 parts when split by '_'
  if (parts.length !== 4 || parts[0] !== "orch" || parts[1] !== "live") {
    return null;
  }

  return `${parts[0]}_${parts[1]}_${parts[2]}`;
}

/**
 * Performs a timing-safe comparison of two hash hex strings to prevent timing attacks.
 */
export function verifyApiKeyHash(
  providedKey: string,
  storedHash: string,
): boolean {
  const computedHash = hashApiKey(providedKey);

  const computedBuffer = Buffer.from(computedHash, "utf8");
  const storedBuffer = Buffer.from(storedHash, "utf8");

  if (computedBuffer.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(computedBuffer, storedBuffer);
}
