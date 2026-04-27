/**
 * Satisfies Vercel’s “entry file” check for this repo. The site is served from
 * `public/` and API routes from `api/`. Local dev: `npm start` → `scripts/local-server.mjs`.
 */
export default function vercelEntry(req, res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}
