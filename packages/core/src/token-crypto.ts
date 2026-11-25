/**
 * Encryption at rest for third-party tokens (Shopify, Klaviyo).
 * AES-256-GCM via Web Crypto. The key lives outside the database
 * (TOKEN_ENCRYPTION_KEY secret, 32 bytes, base64).
 *
 * Format: "v1:<base64 iv>:<base64 ciphertext+tag>".
 */

const PREFIX = "v1";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importTokenKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key);
  if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function isEncryptedToken(value: string): boolean {
  return value.startsWith(`${PREFIX}:`);
}

export async function encryptToken(plain: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plain);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  return `${PREFIX}:${toBase64(iv)}:${toBase64(ct)}`;
}

export async function decryptToken(stored: string, key: CryptoKey): Promise<string> {
  const [prefix, ivB64, ctB64] = stored.split(":");
  if (prefix !== PREFIX || !ivB64 || !ctB64) throw new Error("Unrecognized encrypted token format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivB64) }, key, fromBase64(ctB64));
  return new TextDecoder().decode(plain);
}
