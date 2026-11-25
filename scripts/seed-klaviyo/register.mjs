// Resolve hook for running the CLI with plain Node (no bundler, no dependencies).
//
// @tiersaver/core exports TypeScript source whose relative imports use the
// ".js" extension (TypeScript "Bundler" resolution). Node's built-in type
// stripping does not rewrite extensions, so when a relative "./x.js" specifier
// is missing on disk we retry it as "./x.ts".
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (relative && specifier.endsWith(".js") && error?.code === "ERR_MODULE_NOT_FOUND") {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});
