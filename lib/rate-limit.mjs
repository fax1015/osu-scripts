import { isRedisRestConfigured, runRedis } from "./persist-settings.mjs";
import { validSessionId } from "./session.mjs";

const MAX_PER_MINUTE = 5;
const MAX_PER_HOUR = 30;

const minuteKey = (sessionId) => `osu-scripts:ratelimit:${sessionId}:minute`;
const hourKey = (sessionId) => `osu-scripts:ratelimit:${sessionId}:hour`;

/** @type {Map<string, { ts: number[] }>} */
const memoryBySession = new Map();

/**
 * @param {string} sessionId
 */
export async function clearSessionRatelimitKeys(sessionId) {
  if (!validSessionId(sessionId)) {
    return;
  }
  memoryBySession.delete(sessionId);
  if (!isRedisRestConfigured()) {
    return;
  }
  try {
    await runRedis(["DEL", minuteKey(sessionId)]);
    await runRedis(["DEL", hourKey(sessionId)]);
  } catch (error) {
    console.error("Failed to clear rate limit keys from Redis:", error);
  }
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ allowed: boolean, error?: string, retryAfterSec?: number }>}
 */
export async function consumeRunSlot(sessionId) {
  if (!validSessionId(sessionId)) {
    return { allowed: true };
  }
  if (isRedisRestConfigured()) {
    return consumeRunSlotRedis(sessionId);
  }
  return consumeRunSlotMemory(sessionId);
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ allowed: boolean, error?: string, retryAfterSec?: number }>}
 */
async function consumeRunSlotRedis(sessionId) {
  const mK = minuteKey(sessionId);
  const hK = hourKey(sessionId);
  try {
    const m = await runRedis(["INCR", mK]);
    if (m == null) {
      return { allowed: true };
    }
    const mNum = Number(m);
    if (mNum === 1) {
      await runRedis(["EXPIRE", mK, "60"]);
    }
    if (mNum > MAX_PER_MINUTE) {
      await runRedis(["DECR", mK]);
      return { allowed: false, error: "calm down!! too many script runs. try again in a minute.", retryAfterSec: 60 };
    }
    const h = await runRedis(["INCR", hK]);
    if (h == null) {
      return { allowed: true };
    }
    const hNum = Number(h);
    if (hNum === 1) {
      await runRedis(["EXPIRE", hK, "3600"]);
    }
    if (hNum > MAX_PER_HOUR) {
      await runRedis(["DECR", mK]);
      await runRedis(["DECR", hK]);
      return { allowed: false, error: "oops... hourly run limit reached. take a break and try again later.", retryAfterSec: 3600 };
    }
  } catch (error) {
    console.error("Rate limit Redis error (allowing request):", error);
    return { allowed: true };
  }
  return { allowed: true };
}

/**
 * @param {string} sessionId
 * @returns {{ allowed: boolean, error?: string, retryAfterSec?: number }}
 */
function consumeRunSlotMemory(sessionId) {
  const now = Date.now();
  let rec = memoryBySession.get(sessionId) || { ts: [] };
  rec.ts = rec.ts.filter((t) => now - t < 60 * 60 * 1000);
  const inMinute = rec.ts.filter((t) => now - t < 60 * 1000);
  if (inMinute.length >= MAX_PER_MINUTE) {
    return { allowed: false, error: "calm down!! too many script runs. try again in a minute.", retryAfterSec: 60 };
  }
  if (rec.ts.length >= MAX_PER_HOUR) {
    return { allowed: false, error: "oops... hourly run limit reached. take a break and try again later.", retryAfterSec: 3600 };
  }
  rec.ts.push(now);
  memoryBySession.set(sessionId, rec);
  return { allowed: true };
}
