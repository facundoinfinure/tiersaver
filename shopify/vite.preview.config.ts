// Vite config of the local preview (see preview/README.md). The production build uses vite.config.ts.
// It sits next to vite.config.ts because React Router takes the app root from the config file's folder.
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const real = path.resolve(__dirname, "app/shopify.server.ts");
const stub = path.resolve(__dirname, "preview/shopify.server.stub.ts");

/** Swaps the Shopify module for the stub, whoever imports it. */
function shopifyStub(): Plugin {
  return {
    name: "tiersaver-preview-shopify-stub",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !source.includes("shopify.server")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && resolved.id.split("?")[0] === real ? stub : null;
    },
  };
}

export default defineConfig({
  server: { port: 3210, strictPort: true, hmr: { port: 64998 }, fs: { allow: ["app", "workers", "preview", "node_modules", "../packages", "../node_modules"] } },
  plugins: [shopifyStub(), cloudflare({ configPath: path.resolve(__dirname, "preview/wrangler.preview.jsonc"), viteEnvironment: { name: "ssr" } }), reactRouter(), tsconfigPaths()],
  build: { assetsInlineLimit: 0 },
  optimizeDeps: { include: ["@shopify/app-bridge-react"] },
});
