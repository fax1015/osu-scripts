# osu! scripts

Standalone Node tools for small osu! profile lookups, plus a **web UI** (guest-difficulty BBCode export and oldest public scores). Run the UI locally with Node, or deploy to **Vercel** for a hosted instance.

## Web UI — local

```bash
npm install
npm start
```

Open **http://127.0.0.1:4173** (or the URL printed in the terminal). Use **Close app** to stop the server.

The header **Look A / B / C** control switches between three layout themes (choice is saved in `localStorage`, and `?design=2` or `?design=3` in the URL loads B or C on first paint).

```bash
npm run open
```

starts the server and tries to open a browser tab.

### Settings storage (local)

The UI saves script options and OAuth tokens in **`.osu-script-ui-settings.json`** in the repo root (gitignored). You can also set **`OSU_ACCESS_TOKEN`** in the environment before `npm start` as a fallback for the guest exporter.

### OAuth (local or Vercel)

1. Create an OAuth application on your osu! account.
2. Set the application’s **callback URL** to exactly what the site shows (for local: `http://127.0.0.1:4173/auth/osu/callback`; for Vercel: `https://<your-deployment>.vercel.app/auth/osu/callback`).
3. Paste **Client ID** and **Client Secret** under **Account & setup**, click **Save settings**, then **Log in**.

Reference: https://osu.ppy.sh/docs/#oauth

### Port and host (local only)

```powershell
$env:PORT = "4174"
node server.mjs
```

The server binds to **`127.0.0.1`** by default (`HOST` env overrides it).

## Web UI — Vercel

1. Push this repository to GitHub and import it in the [Vercel dashboard](https://vercel.com/new), or run `npx vercel` from the project root.
2. In the Vercel project, add a **Blob** store (Storage → Create → Blob) and copy **`BLOB_READ_WRITE_TOKEN`** into **Project → Environment variables**. Without it, production cannot persist OAuth and form settings across cold starts.
3. Set **`OSU_ACCESS_TOKEN`** (optional) if you want the server to always have a token without logging in through the UI.
4. In your osu! OAuth app, set the callback URL to **`https://<your-project>.vercel.app/auth/osu/callback`** (same path the UI displays after deploy).
5. Redeploy after changing env vars.

**Guest exporter on Vercel:** the server runs the script with **`--output=-`**, so the BBCode is returned in the JSON response and can be **downloaded from the browser** instead of being written on the server filesystem.

**Function duration:** `api/run` is configured for up to **300 seconds** in `vercel.json`. Very large guest scans can still hit plan limits; the Hobby tier has shorter defaults than Pro — see [Vercel function limits](https://vercel.com/docs/functions/limitations). For huge exports, run **`node find-osu-guest-difficulties.mjs`** locally.

**Repository link in the footer:** set the `content` attribute of `<meta name="app-repo">` in `public/index.html` to your public GitHub URL.

### Local parity with Vercel

```bash
npx vercel dev
```

runs the same API routes against your working tree (requires the Vercel CLI).

## Guest difficulty BBCode exporter

`find-osu-guest-difficulties.mjs`:

- accepts an osu! profile link, username, or numeric user id
- scans the profile's public `guest` beatmapset feed
- keeps only difficulties mapped by that user on other people's beatmapsets
- includes collab difficulties when the target user is one of the difficulty owners
- writes osu! forum BBCode into a `.txt` file
- skips beatmap links already present in the `.txt` file on later runs
- refreshes existing lines so ranked, loved, pending, wip, and graveyard maps get a color-coded status tag
- writes one spoiler box and one notice box, with bold year headings inside

For every status (`ranked`, `loved`, `pending`, `wip`, `graveyard`, etc.), set `OSU_ACCESS_TOKEN` to an osu! OAuth token for the same user you are exporting. With that token, the script uses osu!'s authenticated all-status `mine` beatmapset search and filters out self-owned sets afterward.

Without `OSU_ACCESS_TOKEN`, the script falls back to osu!'s public profile route (`/users/{id}/beatmapsets/guest`). That public route only exposes ranked/loved guest beatmapsets.

```bash
node find-osu-guest-difficulties.mjs "https://osu.ppy.sh/users/124493"
```

Useful options:

```bash
node find-osu-guest-difficulties.mjs "https://osu.ppy.sh/users/124493" --output=./guest-difficulties.txt
node find-osu-guest-difficulties.mjs "https://osu.ppy.sh/users/124493" --modes=osu
node find-osu-guest-difficulties.mjs "https://osu.ppy.sh/users/124493" --sort=beatmap-id
node find-osu-guest-difficulties.mjs "https://osu.ppy.sh/users/124493" --sort=difficulty-updated
node find-osu-guest-difficulties.mjs "https://osu.ppy.sh/users/124493" --concurrency=8
node find-osu-guest-difficulties.mjs "https://osu.ppy.sh/users/124493" --dry-run
node find-osu-guest-difficulties.mjs "https://osu.ppy.sh/users/124493" --verbose
node find-osu-guest-difficulties.mjs "https://osu.ppy.sh/users/124493" --json
```

Sorting defaults to `beatmap-id`, which is usually a better proxy for when a difficulty was created than the beatmapset's upload/ranked date. `difficulty-updated` uses the difficulty's `last_updated` value, and `set-date` uses the old beatmapset-level date fallback.

Full beatmapset detail requests run in parallel, and the script prints a progress bar while that happens. Use `--concurrency` to tune how many detail requests run at once.

The script does not reorder entries already in the output file; it only sorts new entries before appending them into each year section.

Items inside each year section are written on consecutive lines without blank lines between them.

PowerShell example with an OAuth token:

```powershell
$env:OSU_ACCESS_TOKEN = "your-user-access-token"
node find-osu-guest-difficulties.mjs "https://osu.ppy.sh/users/124493" --output=./guest-difficulties.txt
```

Output format:

```bbcode
[box=giant list of gds - 2]
[notice]
most recently updated maps are at the top

[b]2026 - 1[/b]
[url=https://osu.ppy.sh/beatmapsets/2322452#osu/5573977]Negentropy - ouroVoros (faxaxaxa's Normal)[/url] - [size=85][color=#ffd166](Pending)[/color][/size]

[b]2025 - 1[/b]
[url=https://osu.ppy.sh/beatmapsets/2265324#osu/4829436]25-ji, Nightcord de. x KAITO - BAKENOHANA (faxaxaxa's Expert)[/url] - [size=85][color=#b7f36b](Ranked)[/color][/size]

[/notice]
[/box]
```

## Oldest public score finder

`find-oldest-osu-score.mjs`:

- accepts an osu! profile link, username, or numeric user id
- scans the public score feeds exposed by the osu! website
- builds a local index of the fetched scores if you want one
- reports the 5 oldest publicly discoverable scores it can find

## Important limitation

osu! does **not** expose a full lifetime score history on the public profile pages. The script only searches the public profile score feeds the website exposes, such as `firsts`, `best`, and `recent`.

That means the result is:

- the oldest score visible from those public web feeds
- not necessarily the user's absolute oldest play ever

## Requirements

- Node.js 18+ with built-in `fetch`

## Usage

```bash
node find-oldest-osu-score.mjs "https://osu.ppy.sh/users/124493"
```

You can also pass a numeric user id:

```bash
node find-oldest-osu-score.mjs 124493
```

## Useful options

```bash
node find-oldest-osu-score.mjs "https://osu.ppy.sh/users/124493" --verbose
node find-oldest-osu-score.mjs "https://osu.ppy.sh/users/124493" --json
node find-oldest-osu-score.mjs "https://osu.ppy.sh/users/124493" --modes=osu
node find-oldest-osu-score.mjs "https://osu.ppy.sh/users/124493" --feeds=firsts,best
node find-oldest-osu-score.mjs "https://osu.ppy.sh/users/124493" --save-index=./scores.json
node find-oldest-osu-score.mjs "https://osu.ppy.sh/users/124493" --page-size=100 --max-pages=5
```

## Output

The script prints:

- the resolved user id and profile URL
- how many raw and unique scores it indexed
- the 5 oldest publicly discoverable scores
- a direct score link for each result
- a note explaining the public-data limitation
