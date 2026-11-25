// Minimal Web API globals used by core. Present in Node 22 and Cloudflare Workers.
declare class TextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer>;
}
declare class TextDecoder {
  decode(input?: ArrayBuffer | Uint8Array): string;
}
declare function btoa(data: string): string;
declare function atob(data: string): string;
interface CryptoKey {
  readonly type: string;
}
declare const crypto: {
  getRandomValues<T extends Uint8Array>(array: T): T;
  subtle: {
    digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
    importKey(
      format: "raw",
      keyData: Uint8Array,
      algorithm: { name: "AES-GCM" },
      extractable: boolean,
      keyUsages: ("encrypt" | "decrypt")[],
    ): Promise<CryptoKey>;
    encrypt(algorithm: { name: "AES-GCM"; iv: Uint8Array }, key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer>;
    decrypt(algorithm: { name: "AES-GCM"; iv: Uint8Array }, key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer>;
  };
};
