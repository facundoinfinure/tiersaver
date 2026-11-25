// Bundles scripts/preview-ui.tsx with esbuild and runs it. See that file.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const outfile = join(mkdtempSync(join(tmpdir(), "tiersaver-preview-")), "preview.mjs");
await build({ entryPoints: [new URL("./preview-ui.tsx", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", jsx: "automatic", outfile, logLevel: "error", banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
process.exit(spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1);
