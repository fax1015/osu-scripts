import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validSessionId } from "./session.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.join(__dirname, "..");
const SESSIONS_DIR = path.join(ROOT_DIR, ".osu-script-sessions");

/**
 * @param {string} sessionId
 * @returns {string}
 */
export function sessionStorageKey(sessionId) {
  return `osu-scripts:session:${sessionId}`;
}

function redisRestConfig() {
  const url = (
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_KV_REST_API_URL ||
    ""
  ).trim();
  const token = (
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_REDIS_KV_REST_API_TOKEN ||
    ""
  ).trim();

  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function persistenceStatus() {
  const config = redisRestConfig();
  return {
    type: config ? "redis-rest" : "local-file",
    configured: Boolean(config),
    env: {
      hasKvUrl: Boolean(process.env.KV_REST_API_URL?.trim()),
      hasKvToken: Boolean(process.env.KV_REST_API_TOKEN?.trim()),
      hasUpstashUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim()),
      hasUpstashToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN?.trim()),
      hasPrefixedUpstashUrl: Boolean(process.env.UPSTASH_REDIS_KV_REST_API_URL?.trim()),
      hasPrefixedUpstashToken: Boolean(process.env.UPSTASH_REDIS_KV_REST_API_TOKEN?.trim()),
    },
  };
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

/**
 * @param {string} sessionId
 */
export async function persistLoad(sessionId) {
  if (!validSessionId(sessionId)) {
    return null;
  }
  if (redisRestConfig()) {
    const key = sessionStorageKey(sessionId);
    try {
      const raw = await redisCommand(["GET", key]);
      if (!raw) {
        return null;
      }
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (error) {
      console.error("Failed to load session settings from Redis:", error);
      return null;
    }
  }

  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} sessionId
 * @param {unknown} data
 */
export async function persistSave(sessionId, data) {
  if (!validSessionId(sessionId)) {
    return;
  }
  if (redisRestConfig()) {
    await redisCommand(["SET", sessionStorageKey(sessionId), JSON.stringify(data)]);
    return;
  }

  await mkdir(SESSIONS_DIR, { recursive: true });
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
