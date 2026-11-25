import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { decryptToken, encryptToken, importTokenKey, isEncryptedToken } from "@tiersaver/core";

/**
 * Wraps a session storage so access and refresh tokens are encrypted at rest.
 * The key comes from the TOKEN_ENCRYPTION_KEY secret, never from the database.
 */
export class EncryptedSessionStorage implements SessionStorage {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(
    private readonly inner: SessionStorage,
    private readonly getKeyB64: () => string | undefined,
  ) {}

  private key(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      const b64 = this.getKeyB64();
      if (!b64) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
      this.keyPromise = importTokenKey(b64);
    }
    return this.keyPromise;
  }

  private async transform(session: Session, fn: (v: string) => Promise<string>): Promise<Session> {
    const params = session.toObject();
    if (params.accessToken) params.accessToken = await fn(params.accessToken);
    if (params.refreshToken) params.refreshToken = await fn(params.refreshToken);
    return new Session(params);
  }

  private async encrypt(session: Session): Promise<Session> {
    const key = await this.key();
    return this.transform(session, (v) => (isEncryptedToken(v) ? Promise.resolve(v) : encryptToken(v, key)));
  }

  private async decrypt(session: Session): Promise<Session> {
    const key = await this.key();
    return this.transform(session, (v) => (isEncryptedToken(v) ? decryptToken(v, key) : Promise.resolve(v)));
  }

  async storeSession(session: Session): Promise<boolean> {
    return this.inner.storeSession(await this.encrypt(session));
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const s = await this.inner.loadSession(id);
    return s ? this.decrypt(s) : undefined;
  }

  deleteSession(id: string): Promise<boolean> {
    return this.inner.deleteSession(id);
  }

  deleteSessions(ids: string[]): Promise<boolean> {
    return this.inner.deleteSessions(ids);
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const sessions = await this.inner.findSessionsByShop(shop);
    return Promise.all(sessions.map((s) => this.decrypt(s)));
  }
}
