import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kv } from "@vercel/kv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.join(__dirname, "..");
const FILE_SETTINGS = path.join(ROOT_DIR, ".osu-script-ui-settings.json");
const KV_SETTINGS_KEY = "osu-scripts:ui-settings";

function kvConfigured() {
  return Boolean(
    process.env.KV_REST_API_URL?.trim() && process.env.KV_REST_API_TOKEN?.trim(),
  );
}

export async function persistLoad() {
  if (kvConfigured()) {
    try {
      return await kv.get(KV_SETTINGS_KEY);
    } catch (error) {
      console.error("Failed to load settings from Vercel KV:", error);
      return null;
    }
  }

  try {
    const raw = await readFile(FILE_SETTINGS, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function persistSave(data) {
  if (kvConfigured()) {
    await kv.set(KV_SETTINGS_KEY, data);
    return;
  }

  await writeFile(FILE_SETTINGS, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
