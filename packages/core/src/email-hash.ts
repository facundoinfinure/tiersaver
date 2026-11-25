/**
 * Email matching without storing emails: normalize, then SHA-256 (hex).
 * Uses Web Crypto, available in Node 22 and Cloudflare Workers.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashEmail(email: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeEmail(email));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
