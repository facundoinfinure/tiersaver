import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Shopify sessions. Column set required by
 * @shopify/shopify-app-session-storage-drizzle (SQLite adapter).
 * accessToken and refreshToken hold ciphertext (see app/session-storage.server.ts).
 */
export const sessionTable = sqliteTable("session", {
  id: text("id").primaryKey(),
  shop: text("shop").notNull(),
  state: text("state").notNull(),
  isOnline: integer("isOnline", { mode: "boolean" }).notNull().default(false),
  scope: text("scope"),
  expires: text("expires"),
  accessToken: text("accessToken").notNull(),
  userId: blob("userId", { mode: "bigint" }),
  firstName: text("firstName"),
  lastName: text("lastName"),
  email: text("email"),
  accountOwner: integer("accountOwner", { mode: "boolean" }),
  locale: text("locale"),
  collaborator: integer("collaborator", { mode: "boolean" }),
  emailVerified: integer("emailVerified", { mode: "boolean" }),
  refreshToken: text("refreshToken"),
  refreshTokenExpires: text("refreshTokenExpires"),
});
