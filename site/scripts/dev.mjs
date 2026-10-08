// The dev server in a build directory of its own. Next always builds for production in `.next`:
// with `output: "export"` a custom distDir names the export folder instead (hasCustomExportOutput in
// next's build/index.js), so `npm run build` while `npm run dev` was up used to overwrite the dev
// server's files mid-flight. Here dev takes `.next-dev` and the build keeps the defaults, `.next` for
// its work and `out/` for the site. Cross-platform without extra dependencies.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const r = spawnSync(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || ".next-dev" },
});
process.exit(r.status ?? 1);
