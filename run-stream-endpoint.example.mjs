// Example Express endpoint for live script logs.
// Drop the route body into your server file and adapt buildRunCommand/parseStructuredResult
// to match your existing /api/run implementation.

import { spawn } from "node:child_process";

function writeNdjson(res, event) {
  res.write(`${JSON.stringify(event)}\n`);
}

function parseLastJsonLine(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // Not JSON. Keep looking.
    }
  }
  return null;
}

// Replace this with your current /api/run command builder.
function buildRunCommand({ script, target, settings }) {
  const file = script === "guest"
    ? "find-osu-guest-difficulties.mjs"
    : "find-oldest-osu-score.mjs";

  const args = [file, target, "--json"];

  // Add your existing settings-to-CLI-args logic here.
  // Example:
  // if (settings.verbose) args.push("--verbose");
  // if (settings.output) args.push(`--output=${settings.output}`);

  return {
    command: process.execPath,
    args,
    options: {
      cwd: process.cwd(),
      env: process.env,
    },
  };
}

app.post("/api/run/stream", express.json(), (req, res) => {
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const { command, args, options } = buildRunCommand(req.body);
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    writeNdjson(res, { type: "log", stream: "stdout", text });
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    writeNdjson(res, { type: "log", stream: "stderr", text });
  });

  child.on("error", (error) => {
    writeNdjson(res, { type: "error", message: error.message });
    res.end();
  });

  child.on("close", (code) => {
    const structured = parseLastJsonLine(stdout);
    writeNdjson(res, {
      type: "done",
      result: {
        ok: code === 0,
        code,
        stdout,
        stderr,
        structured,
      },
    });
    res.end();
  });

  req.on("close", () => {
    if (!child.killed) child.kill();
  });
});
