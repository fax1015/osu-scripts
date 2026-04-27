/**
 * Satisfies Vercel’s “entry file” check. The deployed site is `public/` + `api/*`.
 * This file must not live at repo root as `index.mjs` — that would override `/`.
 */
export default function vercelBuildEntry() {}
