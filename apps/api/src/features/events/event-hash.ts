import { CryptoHasher } from "bun";

/**
 * Deterministically serializes any JavaScript value to a canonical JSON string.
 * - Object keys are recursively sorted alphabetically.
 * - Array element orders are preserved.
 * - Primitives (strings, numbers, booleans, nulls) are safely serialized.
 */
export function canonicalJsonStringify(val: unknown): string {
  if (val === null || val === undefined) {
    return "null";
  }
  if (typeof val === "boolean" || typeof val === "number") {
    return JSON.stringify(val);
  }
  if (typeof val === "string") {
    return JSON.stringify(val);
  }
  if (val instanceof Date) {
    return JSON.stringify(val.toISOString());
  }
  if (Array.isArray(val)) {
    return "[" + val.map(canonicalJsonStringify).join(",") + "]";
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of sortedKeys) {
      const v = obj[key];
      if (v !== undefined) {
        parts.push(`${JSON.stringify(key)}:${canonicalJsonStringify(v)}`);
      }
    }
    return "{" + parts.join(",") + "}";
  }
  return JSON.stringify(val);
}

export interface SemanticEventInput {
  type: string;
  data: Record<string, unknown>;
  occurred_at?: string;
}

/**
 * Computes the deterministic SHA-256 request hash for an event ingestion request.
 * Only validated semantic input (type, data, and optional explicit occurred_at) is included.
 * Server-generated timestamps or IDs are excluded.
 */
export function calculateEventRequestHash(input: SemanticEventInput): string {
  const semanticObject: Record<string, unknown> = {
    type: input.type,
    data: input.data,
  };

  if (input.occurred_at) {
    semanticObject.occurred_at = input.occurred_at;
  }

  const canonical = canonicalJsonStringify(semanticObject);
  const hasher = new CryptoHasher("sha256");
  hasher.update(canonical);
  return hasher.digest("hex");
}
