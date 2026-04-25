import { handleOAuthCallback } from "../../../lib/server-handlers.mjs";

export default async function handler(req, res) {
  const host = req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || "https";
  const url = new URL(req.url || "/", `${proto}://${host}`);
  await handleOAuthCallback(req, res, url);
}
