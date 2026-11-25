import "@shopify/shopify-api/adapters/cf-worker";
import { env } from "cloudflare:workers";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { DrizzleSessionStorageSQLite } from "@shopify/shopify-app-session-storage-drizzle";
import { db, schema } from "./db.server";
import { EncryptedSessionStorage } from "./session-storage.server";

const sessionStorage = new EncryptedSessionStorage(
  new DrizzleSessionStorageSQLite(db, schema.sessionTable),
  () => env.TOKEN_ENCRYPTION_KEY,
);

const shopify = shopifyApp({
  apiKey: env.SHOPIFY_API_KEY,
  apiSecretKey: env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: env.SCOPES?.split(","),
  appUrl: env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage,
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export { sessionStorage };
