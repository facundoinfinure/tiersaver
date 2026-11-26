/**
 * Email matching without storing emails: normalize, then HMAC-SHA-256 (hex)
 * with a secret key. A plain SHA-256 of an email can be reversed by trying
 * known addresses, and is the same in every store; a keyed hash is neither.
 * The caller supplies the key (the app derives one per store).
 * Uses Web Crypto, available in Node 22 and Cloudflare Workers.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

/** Imports raw key bytes (or a string) as an HMAC-SHA-256 signing key. */
export async function importHashKey(key: string | ArrayBuffer): Promise<CryptoKey> {
  const raw = typeof key === "string" ? new TextEncoder().encode(key) : key;
  if (raw.byteLength < 16) throw new Error("email hash key is missing or too short");
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function hashEmail(email: string, key: CryptoKey): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(normalizeEmail(email))));
}
