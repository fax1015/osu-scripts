import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const files = [
  "preview/src/settings.js",
  "preview/src/parser.js",
  "preview/src/renderer.js",
  "preview/src/preview-init.js",
];

let bundle = "// OSU PREVIEW BUNDLE\n(function() {\n";

for (const file of files) {
  const abs = path.join(root, file);
  let content = fs.readFileSync(abs, "utf8");
  // Remove imports
  content = content.replace(/import\s*\{[\s\S]*?\}\s*from\s*'.*?';?/g, "");
  content = content.replace(/import\s*.*?\s*from\s*'.*?';?/g, "");
  // Remove exports
  content = content.replace(/^export\s+/gm, "");
  content = content.replace(/^export\s*\{[\s\S]*?\};?/gm, "");

  bundle += `\n// --- ${file} ---\n${content}\n`;
}

bundle += "\n})();";

const outPath = path.join(root, "public", "preview", "preview-bundle.js");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, bundle, "utf8");
console.log(`Wrote ${outPath}`);
