import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, importTokenKey, isEncryptedToken } from "../src/index.js";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const KEY_B64 = b64(new Uint8Array(32).map((_, i) => i));

describe("token encryption", () => {
  it("round-trips and never stores plaintext", async () => {
    const key = await importTokenKey(KEY_B64);
    const enc = await encryptToken("shpat_secret_value", key);
    expect(isEncryptedToken(enc)).toBe(true);
    expect(enc).not.toContain("shpat_secret_value");
    expect(await decryptToken(enc, key)).toBe("shpat_secret_value");
  });
  it("uses a fresh IV each time", async () => {
    const key = await importTokenKey(KEY_B64);
    expect(await encryptToken("x", key)).not.toBe(await encryptToken("x", key));
  });
  it("rejects tampering and wrong keys", async () => {
    const key = await importTokenKey(KEY_B64);
    const enc = await encryptToken("token", key);
    const tampered = enc.slice(0, -4) + (enc.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(decryptToken(tampered, key)).rejects.toThrow();
    const other = await importTokenKey(b64(new Uint8Array(32).fill(7)));
    await expect(decryptToken(enc, other)).rejects.toThrow();
  });
  it("requires a 32-byte key", async () => {
    await expect(importTokenKey(btoa("short"))).rejects.toThrow(/32 bytes/);
  });
});
