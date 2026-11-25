import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd with a real (local) D1 database and the real
// Workflows engine, using the same SQL migrations that are applied in production.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./test/wrangler.jsonc" },
        // LIVE_KLAVIYO_RELAY is only set for the live integration test (see test/live-klaviyo.test.ts); empty skips it.
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, LIVE_KLAVIYO_RELAY: process.env.LIVE_KLAVIYO_RELAY ?? "" } },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
