#!/usr/bin/env node
/**
 * Publish the current version to the public npm registry.
 * Does not bump the version, push tags, or touch GitHub Actions.
 *
 * Usage:
 *   node tools/publish-npm.mjs
 *   node tools/publish-npm.mjs --dry-run
 *   npm run publish:npm
 *   npm run publish:npm:dry
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const registry = "https://registry.npmjs.org";

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
  console.error(`Refuse to publish from branch "${branch}". Switch to main/master.`);
  process.exit(1);
}

const dirty = shOut("git status --porcelain");
if (dirty) {
  console.error("Working tree is dirty. Commit or stash changes before publishing:\n");
  console.error(dirty);
  process.exit(1);
}

const pkg = readPkg();
const spec = `${pkg.name}@${pkg.version}`;
console.log(`${dryRun ? "Dry-run" : "Publish"} ${spec} → ${registry}`);

let whoami = "";
try {
  whoami = shOut(`npm whoami --registry ${registry}`);
} catch {
  console.error(`Not logged in to npm. Run: npm login --registry ${registry}`);
  process.exit(1);
}
console.log(`npm user: ${whoami}`);

let already = "";
try {
  already = shOut(`npm view ${spec} version --registry ${registry}`);
} catch {
  already = "";
}
if (already) {
  console.error(`${spec} is already on the registry. Bump the version first (npm run release:patch).`);
  process.exit(1);
}

sh("npm run typecheck");
sh("npm run build");

const publishCmd = dryRun
  ? `npm publish --dry-run --access public --registry ${registry}`
  : `npm publish --access public --registry ${registry}`;
sh(publishCmd);

if (dryRun) {
  console.log(`\nDry-run only. Nothing was published. To publish: npm run publish:npm`);
} else {
  console.log(`\nPublished ${spec}`);
  console.log(`https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`);
}
