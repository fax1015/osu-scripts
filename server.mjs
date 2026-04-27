#!/usr/bin/env node

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dispatchHttp, handleStatic, isVercelRuntime } from "./lib/server-handlers.mjs";

const PORT = Number.parseInt(process.env.PORT || "4173", 10);
const HOST = process.env.HOST || "127.0.0.1";
const SHOULD_OPEN_BROWSER = process.argv.includes("--open");

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(data, null, 2)}\n`);
}

function openInBrowser(url) {
  const commandByPlatform = {
    darwin: ["open", [url]],
    linux: ["xdg-open", [url]],
    win32: ["cmd", ["/c", "start", "", url]],
  };
  const [command, args] = commandByPlatform[process.platform] || commandByPlatform.linux;
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

// Vercel serves `public/` and `api/*` only; this file is for local `npm start` (no VERCEL=1).
if (isVercelRuntime()) {
  // Intentionally do not start a Node HTTP server or exit(1) — that breaks builds/health
  // checks if `server.mjs` is ever loaded in the Vercel environment.
} else {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const handled = await dispatchHttp(request, response, url);
      if (!handled) {
        await handleStatic(request, response, url.pathname);
      }
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ok: false,
        error: error.message || "Something went wrong.",
      });
    }
  });

  globalThis.__osuShutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`osu! script UI is running at ${url}`);

    if (SHOULD_OPEN_BROWSER) {
      openInBrowser(url);
    }
  });
}

/**
 * Vercel’s bundler may require a default export if `server.mjs` is referenced. The real app is
 * static files in `public/` plus `api/*.mjs` — in project settings, set **Output Directory** to
 * `public` and do not use this file as the app entry. This handler should not receive traffic.
 */
export default function vercelHandler(req, res) {
  if (isVercelRuntime()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(
      "Not served from server.mjs. Set the Vercel project Output to public/ and use api/ for API routes. See README.",
    );
    return;
  }
  res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
  res.end("This export is only for the Vercel build; use npm start locally.");
}
