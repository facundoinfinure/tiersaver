import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";

/** Drizzle client bound to the D1 database (binding "DB"). */
export const db = drizzle(env.DB, { schema });
export { schema };
