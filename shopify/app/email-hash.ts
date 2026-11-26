import { hashEmail, importHashKey } from "@tiersaver/core";
import { env } from "cloudflare:workers";

/**
 * The only way the app turns an email into a stored value: a keyed hash whose
 * key is derived per store from the HASH_PEPPER secret. Two stores never share
 * a hash for the same person, and a copy of the database alone cannot be
 * matched against known addresses. Without the secret this throws: the app
 * never falls back to an unkeyed hash.
 *
 * Changing HASH_PEPPER invalidates every stored hash. Purchase data then reads
 * as stale and is synced again (everyone is protected meanwhile), and past
 * cleanups can no longer confirm emails, so their profiles are skipped by a
 * restore. Do not rotate it casually.
 */
const keys = new Map<string, Promise<CryptoKey>>();

function shopKey(shop: string): Promise<CryptoKey> {
  let key = keys.get(shop);
  if (!key) {
    key = (async () => {
      const master = await importHashKey((env as { HASH_PEPPER?: string }).HASH_PEPPER ?? "");
      const derived = await crypto.subtle.sign("HMAC", master, new TextEncoder().encode(`tiersaver/email-hash/v1/${shop.toLowerCase()}`));
      return importHashKey(derived);
    })();
    keys.set(shop, key);
    key.catch(() => keys.delete(shop));
  }
  return key;
}

export async function hashShopEmail(shop: string, email: string): Promise<string> {
  return hashEmail(email, await shopKey(shop));
}

/** Keyed hash of a Klaviyo account id, the same for every store (it has to be recognised after a reinstall). */
export async function hashKlaviyoAccountId(accountId: string): Promise<string> {
  const hex = Array.from(new TextEncoder().encode(accountId), (b) => b.toString(16).padStart(2, "0")).join("");
  return hashEmail(hex, await shopKey("global/klaviyo-account"));
}
