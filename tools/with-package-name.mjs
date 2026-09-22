#!/usr/bin/env node
/**
 * Temporarily set package.json "name" for a publish target, then restore.
 *
 * Usage:
 *   node tools/with-package-name.mjs <name> -- <command...>
 *
 * Example (GitHub Packages requires @owner/name):
 *   node tools/with-package-name.mjs @midoelhawy/onvif-node-client -- \
 *     npm publish --access public --registry=https://npm.pkg.github.com
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");
const sep = process.argv.indexOf("--");
if (sep < 0 || process.argv.length < sep + 2) {
  console.error("Usage: node tools/with-package-name.mjs <name> -- <command...>");
  process.exit(1);
}

const tempName = process.argv[2];
const cmd = process.argv.slice(sep + 1).join(" ");
const original = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(original);

pkg.name = tempName;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

let code = 0;
try {
  console.log(`Using package name "${tempName}" for: ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: process.env });
} catch (e) {
  code = e.status ?? 1;
} finally {
  writeFileSync(pkgPath, original.endsWith("\n") ? original : `${original}\n`);
}

process.exit(code);
