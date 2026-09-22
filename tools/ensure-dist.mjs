#!/usr/bin/env node
/**
 * Build dist/ only when missing (git/archive installs). Skip if already present.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const marker = join(rootDir, "dist", "index.js");

if (existsSync(marker)) {
  process.exit(0);
}

console.log("onvif-node-client: dist/ missing — running build (prepare)");
const r = spawnSync("npm", ["run", "build"], {
  cwd: rootDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
