# osu! scripts

Small tools for osu!: **guest-difficulty BBCode** and **oldest public scores**. Includes a **web UI** and matching CLIs in `cli/`.

**Needs Node 18+.**

## Web UI (local)

```bash
npm install
npm start
# optional: npm run open  →  same, plus open a browser
```

Default URL: `http://127.0.0.1:4173`. **Log in with osu!** to use the tools; options are stored in `.osu-script-ui-settings.json` (gitignored).

**OAuth (operator):** create an app on [osu!](https://osu.ppy.sh/home/account/edit#new-oauth-application), set the callback to `http://127.0.0.1:4173/auth/osu/callback` (adjust host/port if you use `HOST` / `PORT`), and set:

- `OSU_OAUTH_CLIENT_ID`
- `OSU_OAUTH_CLIENT_SECRET`

Optional: `OSU_ACCESS_TOKEN` for script runs without a browser session.

## Web UI (Vercel)

In the Vercel project: **Root Directory** = empty (repository root, **not** `public/`). **Framework Preset** = Other, **Build Command** = empty. **Do not** add a root `index.mjs` / `server.mjs` app entry — on Vercel those can take over `/` and hide `public/index.html`. The repo includes `src/index.mjs` + `package.json` `"main"` only so the build finds a Node entry; it is not the web app. The UI is served from **`public/`**; APIs are **`api/*`**. Local dev: `npm start` → `scripts/local-server.mjs`.

Add **`BLOB_READ_WRITE_TOKEN`** (Vercel Blob) so settings persist, set the same OAuth vars, and register callback `https://<your-app>.vercel.app/auth/osu/callback`. Redeploy after env changes.

## CLI

Run from the repo root; use `--help` on each command.

| Script | Purpose |
|--------|---------|
| `cli/find-osu-guest-difficulties.mjs` | Guest-diff BBCode / export |
| `cli/find-oldest-osu-score.mjs` | Oldest scores from public feeds only |

`OSU_ACCESS_TOKEN` improves guest export coverage (all statuses); without it, only ranked/loved show on the public feed.

The oldest-score tool only sees what osu!’s public profile feeds expose—not guaranteed to be a user’s true first play ever.

**Preview asset build** (if you change `preview/src/`): `npm run build:preview`
