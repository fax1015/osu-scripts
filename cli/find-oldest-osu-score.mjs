#!/usr/bin/env node

const DEFAULT_MODES = ["osu", "taiko", "fruits", "mania"];
const DEFAULT_FEEDS = ["firsts", "best", "recent"];
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const RULESET_TO_MODE = {
  0: "osu",
  1: "taiko",
  2: "fruits",
  3: "mania",
};
const MODE_TO_RULESET = Object.fromEntries(
  Object.entries(RULESET_TO_MODE).map(([rulesetId, mode]) => [mode, Number(rulesetId)]),
);
const MODE_ALIASES = {
  osu: "osu",
  taiko: "taiko",
  fruits: "fruits",
  catch: "fruits",
  ctb: "fruits",
  mania: "mania",
};
const ACCESS_TOKEN = process.env.OSU_ACCESS_TOKEN || "";

function printHelp() {
  console.log(`Usage:
  node cli/find-oldest-osu-score.mjs <osu-profile-url-or-user-id> [options]

Options:
  --modes=osu,taiko,fruits,mania   Modes to scan. Default: all
  --feeds=firsts,best,recent       Public profile feeds to scan. Default: all
  --page-size=100                  Scores per request. Default: 100
  --max-pages=0                    Stop after N pages per feed. 0 = no limit
  --save-index=./scores.json       Save the fetched public score index
  --beatmap-id=123456              Find scores for a specific beatmap
  --result-count=5                 How many oldest scores to show (1–100). Default: 5
  --verbose                        Print pagination progress
  --json                           Print a single JSON object to stdout (human summary to stderr)
  --help                           Show this help

Notes:
  With OSU_ACCESS_TOKEN set, this script uses osu!'s official API v2.
  Without a token, it falls back to osu!'s public website score endpoints.
  With a token, --beatmap-id searches only that beatmap (osu! API) for the oldest
  score. Without a token the beatmap option is ignored and only profile feeds
  (all visible maps) are used.
  osu! does not expose a complete lifetime score history on the public profile,
  so, by default, the result is the 5 oldest scores (change with --result-count) discoverable from the feeds.
`);
}

function parseArgs(argv) {
  const options = {
    pageSize: 100,
    maxPages: 0,
    saveIndex: null,
    verbose: false,
    json: false,
    modes: [...DEFAULT_MODES],
    feeds: [...DEFAULT_FEEDS],
    beatmapId: null,
    resultCount: 5,
  };

  let target = null;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg.startsWith("--modes=")) {
      options.modes = parseCsv(arg.slice("--modes=".length), DEFAULT_MODES);
      continue;
    }

    if (arg.startsWith("--feeds=")) {
      options.feeds = parseCsv(arg.slice("--feeds=".length), DEFAULT_FEEDS);
      continue;
    }

    if (arg.startsWith("--page-size=")) {
      options.pageSize = Number.parseInt(arg.slice("--page-size=".length), 10);
      continue;
    }

    if (arg.startsWith("--max-pages=")) {
      options.maxPages = Number.parseInt(arg.slice("--max-pages=".length), 10);
      continue;
    }

    if (arg.startsWith("--save-index=")) {
      options.saveIndex = arg.slice("--save-index=".length);
      continue;
    }

    if (arg.startsWith("--beatmap-id=")) {
      options.beatmapId = arg.slice("--beatmap-id=".length);
      continue;
    }

    if (arg.startsWith("--result-count=")) {
      options.resultCount = Number.parseInt(arg.slice("--result-count=".length), 10);
      continue;
    }

    if (!target) {
      target = arg;
      continue;
    }

    throw new Error(`Unrecognized argument: ${arg}`);
  }

  validateOptions(options);
  return { target, options };
}

function parseCsv(value, allowed) {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (items.length === 0) {
    throw new Error(`Expected a comma-separated list. Allowed values: ${allowed.join(", ")}`);
  }

  const invalid = items.filter((item) => !allowed.includes(item));
  if (invalid.length > 0) {
    throw new Error(`Invalid values: ${invalid.join(", ")}. Allowed values: ${allowed.join(", ")}`);
  }

  return [...new Set(items)];
}

function validateOptions(options) {
  if (!Number.isInteger(options.pageSize) || options.pageSize <= 0) {
    throw new Error("--page-size must be a positive integer");
  }

  if (!Number.isInteger(options.maxPages) || options.maxPages < 0) {
    throw new Error("--max-pages must be 0 or a positive integer");
  }

  if (!Number.isInteger(options.resultCount) || options.resultCount < 1 || options.resultCount > 100) {
    throw new Error("--result-count must be an integer from 1 to 100");
  }
}

function normalizeMode(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return RULESET_TO_MODE[value] || null;
  }

  if (typeof value !== "string") {
    return null;
  }

  return MODE_ALIASES[value.trim().toLowerCase()] || null;
}

async function fetchText(url) {
  const headers = {
    "user-agent": DEFAULT_USER_AGENT,
    accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  };
  if (ACCESS_TOKEN) {
    headers.authorization = `Bearer ${ACCESS_TOKEN}`;
  }
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status} ${response.statusText}) for ${url}`);
  }

  return {
    url: response.url,
    text: await response.text(),
    contentType: response.headers.get("content-type") || "",
  };
}

async function fetchJson(url) {
  const headers = {
    "user-agent": DEFAULT_USER_AGENT,
    accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
  };
  if (ACCESS_TOKEN) {
    headers.authorization = `Bearer ${ACCESS_TOKEN}`;
  }
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status} ${response.statusText}) for ${url}`);
  }

  return response.json();
}

function extractUserId(value) {
  if (/^\d+$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/(?:users|u)\/(\d+)(?:\/|$)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function profileUrlFor(target) {
  if (/^\d+$/.test(target)) {
    return `https://osu.ppy.sh/users/${target}`;
  }

  try {
    return new URL(target).toString();
  } catch {
    return `https://osu.ppy.sh/users/${encodeURIComponent(target)}`;
  }
}

async function resolveUser(target) {
  const directId = extractUserId(target);
  const profileUrl = profileUrlFor(target);

  const profile = await fetchText(profileUrl);
  const resolvedId =
    directId ||
    extractUserId(profile.url) ||
    profile.text.match(/"id":\s*(\d+)/)?.[1] ||
    profile.text.match(/\/users\/(\d+)(?:\/|["'])/)?.[1];

  if (!resolvedId) {
    throw new Error("Could not resolve a numeric osu! user id from the provided profile link.");
  }

  return {
    userId: resolvedId,
    requestedProfile: target,
    resolvedProfileUrl: profile.url,
    profileTitle: profile.text.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || null,
  };
}

function buildScoreUrl(score, mode, source) {
  if (!score || !mode) {
    return null;
  }

  const id = score.legacy_score_id ?? score.id ?? null;
  if (!id) {
    return null;
  }

  // Public profile endpoints return legacy/ruleset score ids. Those MUST use
  // /scores/{mode}/{id}; bare /scores/{id} can resolve to a different solo score.
  if (source === "public-web" || score.legacy_score_id) {
    return `https://osu.ppy.sh/scores/${mode}/${id}`;
  }

  // API v2 score ids are modern solo score ids, so the bare route is correct there.
  return `https://osu.ppy.sh/scores/${id}`;
}

function normalizeScore(score, mode, feed, source = ACCESS_TOKEN ? "api-v2" : "public-web") {
  const endedAt = score.ended_at || score.created_at || null;
  const scoreRulesetMode =
    normalizeMode(score.ruleset_id) ||
    normalizeMode(score.ruleset) ||
    normalizeMode(score.mode);
  const queriedMode = normalizeMode(mode);
  const beatmapMode = normalizeMode(score.beatmap?.mode);
  const actualMode =
    scoreRulesetMode ||
    queriedMode ||
    beatmapMode ||
    null;
  const scoreUrl = buildScoreUrl(score, actualMode, source);
  const legacyScoreUrl =
    actualMode && (score.legacy_score_id || source === "public-web")
      ? `https://osu.ppy.sh/scores/${actualMode}/${score.legacy_score_id ?? score.id}`
      : null;
  const modernScoreUrl =
    source === "api-v2" && score.id
      ? `https://osu.ppy.sh/scores/${score.id}`
      : null;

  return {
    score_id: score.id ?? null,
    user_id: score.user_id ?? score.user?.id ?? null,
    username: score.user?.username ?? null,
    mode: actualMode,
    queried_mode: queriedMode,
    beatmap_mode: beatmapMode,
    ruleset_id: score.ruleset_id ?? MODE_TO_RULESET[actualMode] ?? null,
    discovered_in_feed: feed,
    discovered_at: endedAt,
    ended_at: endedAt,
    rank: score.rank ?? null,
    accuracy: score.accuracy ?? null,
    pp: score.pp ?? null,
    max_combo: score.max_combo ?? null,
    passed: score.passed ?? null,
    legacy_score_id: score.legacy_score_id ?? null,
    total_score: score.total_score ?? score.legacy_total_score ?? null,
    score_url: scoreUrl,
    legacy_score_url: legacyScoreUrl,
    modern_score_url: modernScoreUrl,
    beatmap_id: score.beatmap_id ?? score.beatmap?.id ?? null,
    beatmap_url: score.beatmap?.url ?? null,
    beatmap_version: score.beatmap?.version ?? null,
    beatmapset_id: score.beatmapset?.id ?? score.beatmap?.beatmapset_id ?? null,
    artist: score.beatmapset?.artist ?? null,
    title: score.beatmapset?.title ?? null,
    title_unicode: score.beatmapset?.title_unicode ?? null,
    creator: score.beatmapset?.creator ?? null,
    mods: Array.isArray(score.mods) ? score.mods.map((mod) => mod.acronym).filter(Boolean) : [],
  };
}

function scoreMatchesMode(score, mode) {
  return score.mode === normalizeMode(mode);
}

function userScoresUrl(userId, mode, feed, options, offset) {
  const baseUrl = ACCESS_TOKEN
    ? `https://osu.ppy.sh/api/v2/users/${userId}/scores/${feed}`
    : `https://osu.ppy.sh/users/${userId}/scores/${feed}`;
  const url = new URL(baseUrl);
  url.searchParams.set("mode", mode);
  url.searchParams.set("limit", String(options.pageSize));
  url.searchParams.set("offset", String(offset));

  if (ACCESS_TOKEN) {
    url.searchParams.set("legacy_only", "0");
    url.searchParams.set("include_fails", "0");
  }

  return url;
}

function mergeDuplicateScore(existing, next) {
  const feeds = new Set([
    ...(existing.discovered_in_feeds || [existing.discovered_in_feed]).filter(Boolean),
    ...(next.discovered_in_feeds || [next.discovered_in_feed]).filter(Boolean),
  ]);

  return {
    ...existing,
    ...next,
    discovered_in_feeds: [...feeds].sort(),
    discovered_in_feed: existing.discovered_in_feed || next.discovered_in_feed,
  };
}

async function scanFeed(userId, mode, feed, options) {
  const scores = [];
  let offset = 0;
  let pages = 0;

  while (true) {
    if (options.maxPages > 0 && pages >= options.maxPages) {
      break;
    }

    const url = userScoresUrl(userId, mode, feed, options, offset);
    const batch = await fetchJson(url.toString());
    if (!Array.isArray(batch)) {
      throw new Error(`Unexpected response shape for ${url}`);
    }

    pages += 1;
    if (options.verbose) {
      console.error(`[scan] ${mode}/${feed} page ${pages} offset ${offset}: ${batch.length} score(s)`);
    }

    if (batch.length === 0) {
      break;
    }

    for (const rawScore of batch) {
      const score = normalizeScore(rawScore, mode, feed, ACCESS_TOKEN ? "api-v2" : "public-web");
      if (scoreMatchesMode(score, mode)) {
        scores.push(score);
      } else if (options.verbose) {
        console.error(
          `[scan] skipped ${mode}/${feed} score ${score.score_id || "unknown"} from ${score.mode || "unknown"} mode`,
        );
      }
    }

    if (batch.length < options.pageSize) {
      break;
    }

    offset += options.pageSize;
  }

  return {
    mode,
    feed,
    pages_scanned: pages,
    scores,
  };
}

async function scanBeatmapFeed(userId, beatmapId, mode, options) {
  if (!ACCESS_TOKEN) {
    if (options.verbose) {
      console.error(`[scan] Skipping beatmap ${beatmapId} for ${mode} (no access token provided)`);
    }
    return { mode, feed: `beatmap:${beatmapId}`, pages_scanned: 0, scores: [] };
  }

  const url = `https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}/scores/users/${userId}/all?mode=${mode}`;
  if (options.verbose) {
    console.error(`[scan] fetching beatmap scores for ${beatmapId} (${mode})`);
  }

  try {
    const data = await fetchJson(url);
    const resolvedBeatmapId = Number(beatmapId) || null;
    const scores = (data.scores || [])
      .map((s) => {
        const n = normalizeScore(s, mode, `beatmap:${beatmapId}`, "api-v2");
        // This endpoint often omits top-level `beatmap_id` or nested `beatmap`; the URL path is authoritative.
        const id = n.beatmap_id ?? s.beatmap_id ?? s.beatmap?.id ?? resolvedBeatmapId;
        return { ...n, beatmap_id: id };
      })
      .filter((score) => scoreMatchesMode(score, mode));
    return {
      mode,
      feed: `beatmap:${beatmapId}`,
      pages_scanned: 1,
      scores,
    };
  } catch (error) {
    if (options.verbose) {
      console.error(`[scan] failed to fetch beatmap scores: ${error.message}`);
    }
    return { mode, feed: `beatmap:${beatmapId}`, pages_scanned: 1, scores: [] };
  }
}

function dedupeScores(feedResults) {
  const byId = new Map();

  for (const result of feedResults) {
    for (const score of result.scores) {
      const key = score.score_id
        ? `${score.mode || result.mode}:${score.score_id}`
        : `${score.mode}:${score.discovered_in_feed}:${score.ended_at}:${score.beatmap_id}`;
      const existing = byId.get(key);
      byId.set(key, existing ? mergeDuplicateScore(existing, score) : {
        ...score,
        discovered_in_feeds: [score.discovered_in_feed],
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    const aTime = timestampForScore(a);
    const bTime = timestampForScore(b);

    if (aTime == null && bTime == null) {
      return 0;
    }
    if (aTime == null) {
      return 1;
    }
    if (bTime == null) {
      return -1;
    }
    return aTime - bTime;
  });
}

function timestampForScore(score) {
  if (!score.ended_at) {
    return null;
  }

  const time = new Date(score.ended_at).getTime();
  return Number.isNaN(time) ? null : time;
}

function pickOldestScore(scores) {
  return scores.find((score) => timestampForScore(score) != null) || null;
}

function pickOldestScores(scores, count = 5) {
  return scores.filter((score) => timestampForScore(score) != null).slice(0, count);
}

function formatPercent(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : "n/a";
}

function formatMods(mods) {
  return mods && mods.length > 0 ? `+${mods.join("")}` : "NM";
}

function isBeatmapApiScan(options) {
  return Boolean(options.beatmapId) && Boolean(ACCESS_TOKEN);
}

function displaySongLine(score, beatmapMeta) {
  const fromScore = [score.artist, score.title].filter(Boolean).join(" - ").trim();
  if (fromScore) {
    return fromScore;
  }
  if (beatmapMeta) {
    return [beatmapMeta.artist, beatmapMeta.title].filter(Boolean).join(" - ").trim() || null;
  }
  return null;
}

/** Resolves map title/artist when score payloads omit beatmapset (common on beatmap user-score API). */
async function fetchBeatmapMetadata(beatmapId) {
  if (!ACCESS_TOKEN || !beatmapId) {
    return null;
  }
  const id = String(beatmapId).trim();
  if (!/^\d+$/.test(id)) {
    return null;
  }
  try {
    const b = await fetchJson(`https://osu.ppy.sh/api/v2/beatmaps/${id}`);
    const set = b?.beatmapset;
    return {
      artist: set?.artist || set?.artist_unicode || null,
      title: set?.title || set?.title_unicode || null,
      version: b?.version || null,
      url: b?.url || null,
    };
  } catch {
    return null;
  }
}

function buildStructuredOldestResult(user, options, feedResults, uniqueScores, oldestScores, beatmapMeta) {
  const totalFetched = feedResults.reduce((sum, result) => sum + result.scores.length, 0);
  const oldestScore = oldestScores[0] || null;
  const username = oldestScore?.username || "unknown";
  const useBeatmapApi = isBeatmapApiScan(options);
  const noTokenWithBeatmapId = Boolean(options.beatmapId) && !ACCESS_TOKEN;

  const disclaimer = useBeatmapApi
    ? "scores come from the osu! API for this user on the requested beatmap, a truly earlier play may be missing"
    : noTokenWithBeatmapId
      ? "beatmap filter was skipped: not logged in"
      : "osu! does not expose a full lifetime public score history on profile pages. " +
        "the result is the oldest score discoverable from the selected public web feeds.";

  const scores = oldestScores.map((score) => {
    const line = displaySongLine(score, beatmapMeta);
    const version = score.beatmap_version || beatmapMeta?.version || null;
    return {
      ended_at: score.ended_at,
      mode: score.mode || null,
      discovered_in_feeds: score.discovered_in_feeds,
      beatmapTitle: line || (options.beatmapId ? `Beatmap ${options.beatmapId}` : null),
      beatmap_version: version,
      beatmap_url: score.beatmap_url || beatmapMeta?.url || null,
      rank: score.rank || null,
      accuracy: typeof score.accuracy === "number" ? score.accuracy : null,
      accuracyFormatted: formatPercent(score.accuracy),
      mods: Array.isArray(score.mods) ? score.mods : [],
      modsFormatted: formatMods(score.mods),
      pp: score.pp ?? null,
      max_combo: score.max_combo ?? null,
      score_url: score.score_url || null,
    };
  });

  return {
    type: "oldest-scores",
    user: {
      userId: user.userId,
      username,
      profileUrl: user.resolvedProfileUrl,
      requestedProfile: user.requestedProfile,
    },
    scan: {
      modes: options.modes,
      feeds: useBeatmapApi ? ["beatmap"] : options.feeds,
      beatmapId: options.beatmapId || null,
      resultCount: options.resultCount,
      rawCount: totalFetched,
      uniqueCount: uniqueScores.length,
    },
    oldestScores: scores,
    noScores: !oldestScore,
    disclaimer,
  };
}

function printSummary(user, options, feedResults, uniqueScores, oldestScores, beatmapMeta) {
  const totalFetched = feedResults.reduce((sum, result) => sum + result.scores.length, 0);
  const oldestScore = oldestScores[0] || null;
  const username = oldestScore?.username || "unknown";
  const out = options.json ? console.error : console.log;
  const useBeatmapApi = isBeatmapApiScan(options);

  out(`User: ${username} (#${user.userId})`);
  out(`Profile: ${user.resolvedProfileUrl}`);
  if (useBeatmapApi) {
    out(
      `Scanned: ${options.modes.join(", ")} | beatmap ${options.beatmapId} (API: this user's scores on this map)`,
    );
  } else {
    out(`Scanned: ${options.modes.join(", ")} | feeds: ${options.feeds.join(", ")}`);
  }
  out(`Fetched scores: ${totalFetched} raw / ${uniqueScores.length} unique`);

  if (!oldestScore) {
    out("");
    out(
      useBeatmapApi
        ? "No scores for this user were returned for that beatmap (check beatmap id, mode, and that the play exists on this ruleset)."
        : "No publicly visible scores were returned by the selected osu! profile feeds.",
    );
    return;
  }

  out("");
  out(
    useBeatmapApi
      ? `Oldest ${oldestScores.length} score(s) on that beatmap (from API):`
      : `Oldest ${oldestScores.length} publicly discoverable scores:`,
  );

  oldestScores.forEach((score, index) => {
    const scoreLine = displaySongLine(score, beatmapMeta) || (options.beatmapId ? `beatmap ${options.beatmapId}` : "unknown");
    const ver = score.beatmap_version || beatmapMeta?.version;
    out("");
    out(`${index + 1}. ${score.ended_at}`);
    out(`   Mode: ${score.mode || "n/a"} | Feed(s): ${score.discovered_in_feeds.join(", ")}`);
    out(`   Beatmap: ${scoreLine}${ver ? ` [${ver}]` : ""}`);
    out(`   Rank: ${score.rank || "n/a"} | Accuracy: ${formatPercent(score.accuracy)} | Mods: ${formatMods(score.mods)}`);
    out(`   PP: ${score.pp ?? "n/a"} | Combo: ${score.max_combo ?? "n/a"}`);
    out(`   Score Link: ${score.score_url || "n/a"}`);
    out(`   Beatmap URL: ${score.beatmap_url || beatmapMeta?.url || "n/a"}`);
  });

  out("");
  if (useBeatmapApi) {
    out("Important: the list is what the API returns for this user on that map; the oldest in that set may not be their true first play.");
  } else {
    out("Important: osu! does not expose a full lifetime public score history on profile pages.");
    out("This result is the oldest score discoverable from the selected public web feeds.");
  }
}

async function saveIndex(path, data) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function main() {
  const { target, options } = parseArgs(process.argv.slice(2));

  if (options.help || !target) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const user = await resolveUser(target);

  const useBeatmapApi = isBeatmapApiScan(options);
  if (options.beatmapId && !ACCESS_TOKEN) {
    console.error(
      "Beatmap filter needs an osu! API access token. Without it, this run ignores --beatmap-id. " +
        "Set OSU_ACCESS_TOKEN, or use the web app while signed in.",
    );
  }

  const feedTasks = [];

  for (const mode of options.modes) {
    if (useBeatmapApi) {
      feedTasks.push(scanBeatmapFeed(user.userId, options.beatmapId, mode, options));
    } else {
      for (const feed of options.feeds) {
        feedTasks.push(scanFeed(user.userId, mode, feed, options));
      }
    }
  }

  const feedResults = await Promise.all(feedTasks);
  const uniqueScores = dedupeScores(feedResults);
  const beatmapMeta =
    useBeatmapApi && options.beatmapId ? await fetchBeatmapMetadata(options.beatmapId) : null;
  const oldestScore = pickOldestScore(uniqueScores);
  const oldestScores = pickOldestScores(uniqueScores, options.resultCount);

  printSummary(user, options, feedResults, uniqueScores, oldestScores, beatmapMeta);

  if (options.json) {
    console.log(
      JSON.stringify(
        buildStructuredOldestResult(user, options, feedResults, uniqueScores, oldestScores, beatmapMeta),
      ),
    );
  }

  if (options.saveIndex) {
    await saveIndex(options.saveIndex, {
      generated_at: new Date().toISOString(),
      requested_profile: user.requestedProfile,
      resolved_profile_url: user.resolvedProfileUrl,
      user_id: user.userId,
      profile_title: user.profileTitle,
      modes_scanned: options.modes,
      feeds_scanned: options.feeds,
      limitations: [
        "This index only contains scores available from osu!'s public profile feed endpoints.",
        "osu! does not expose a full lifetime public score history for a user profile.",
      ],
      feed_stats: feedResults.map((result) => ({
        mode: result.mode,
        feed: result.feed,
        pages_scanned: result.pages_scanned,
        scores_fetched: result.scores.length,
      })),
      total_unique_scores: uniqueScores.length,
      oldest_score: oldestScore,
      oldest_scores: oldestScores,
      scores: uniqueScores,
    });

    const out = options.json ? console.error : console.log;
    out(`Saved index to ${options.saveIndex}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
