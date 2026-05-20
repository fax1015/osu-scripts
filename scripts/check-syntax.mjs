#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/persist-settings.mjs";

const INCLUDE_DIRS = ["api", "cli", "lib", "public", "scripts"];
const EXTENSIONS = new Set([".js", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (EXTENSIONS.has(path.extname(entry))) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = INCLUDE_DIRS.flatMap((dir) => collectFiles(path.join(ROOT_DIR, dir)));
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Syntax OK (${files.length} files checked)`);
