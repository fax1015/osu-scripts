import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.join(__dirname, "..");
const FILE_SETTINGS = path.join(ROOT_DIR, ".osu-script-ui-settings.json");
const KV_SETTINGS_KEY = "osu-scripts:ui-settings";

function redisRestConfig() {
  const url = (
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    ""
  ).trim();
  const token = (
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    ""
  ).trim();

  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redisCommand(command) {
  const config = redisRestConfig();
  if (!config) {
    return null;
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Redis REST request failed (${response.status} ${response.statusText}): ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  if (data?.error) {
    throw new Error(`Redis REST error: ${data.error}`);
  }
  return data?.result ?? null;
}

export async function persistLoad() {
  if (redisRestConfig()) {
    try {
      const raw = await redisCommand(["GET", KV_SETTINGS_KEY]);
      if (!raw) {
        return null;
      }
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (error) {
      console.error("Failed to load settings from Redis:", error);
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
  if (redisRestConfig()) {
    await redisCommand(["SET", KV_SETTINGS_KEY, JSON.stringify(data)]);
    return;
  }

  await writeFile(FILE_SETTINGS, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
