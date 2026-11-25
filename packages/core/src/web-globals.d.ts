// Minimal Web API globals used by core. Present in Node 22 and Cloudflare Workers.
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare const crypto: {
  subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> };
};
