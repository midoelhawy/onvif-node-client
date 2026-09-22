#!/usr/bin/env node
/**
 * Bump version, push tag. Consumers install from git (no registry publish yet).
 *
 * Usage:
 *   node tools/release.mjs patch|minor|major
 *   npm run release:patch
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const level = (args.find((a) => !a.startsWith("--")) ?? "").toLowerCase();

if (!["patch", "minor", "major"].includes(level)) {
  console.error("Usage: node tools/release.mjs <patch|minor|major>");
  process.exit(1);
}

function sh(cmd) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { cwd: root, stdio: "inherit" });
}

function shOut(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

function readPkg() {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
}

const branch = shOut("git rev-parse --abbrev-ref HEAD");
if (branch !== "main" && branch !== "master") {
  console.error(`Refuse to release from branch "${branch}". Switch to main/master.`);
  process.exit(1);
}

const dirty = shOut("git status --porcelain");
if (dirty) {
  console.error("Working tree is dirty. Commit or stash changes before releasing:\n");
  console.error(dirty);
  process.exit(1);
}

const behind = shOut("git rev-list --count HEAD..@{u} 2>/dev/null || echo 0");
if (behind !== "0") {
  console.error("Local branch is behind remote. Run: git pull --rebase");
  process.exit(1);
}

const before = readPkg();
console.log(`Releasing ${before.name}@${before.version} (${level})…`);

sh("npm run ci");
sh(`npm version ${level} -m "release: %s"`);

const after = readPkg();
const tag = `v${after.version}`;

sh("git push");
sh("git push --tags");

console.log(`
OK — ${after.name}@${after.version}
Tag: ${tag}

Install (no token):
  npm i github:midoelhawy/onvif-node-client#${tag}

Repo: https://github.com/midoelhawy/onvif-node-client
`);
