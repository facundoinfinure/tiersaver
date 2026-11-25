// Resolve hook for running app modules with plain Node (no bundler):
// `node --experimental-transform-types --import ./scripts/register-ts.mjs <script>.ts`
//
// The app's relative imports have no extension (bundler resolution) and
// @tiersaver/core's use ".js"; both are retried as ".ts" when missing on disk.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (!relative || (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_UNSUPPORTED_DIR_IMPORT")) throw error;
      if (specifier.endsWith(".js")) return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
