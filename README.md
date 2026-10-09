# Show Tracker

A minimalist personal TV tracker, installable as a PWA: **what's coming up** for the shows you follow, and **Beli-style rankings** for the shows you've watched. All data stays on the phone (IndexedDB). See [show-tracker-spec.md](show-tracker-spec.md) for the full spec.

## Setup

```bash
npm install
cp .env.example .env   # then paste your TMDB key into VITE_TMDB_KEY
npm run dev
```

Get a free key at themoviedb.org → Settings → API. Either the v3 "API Key" or the v4 "Read Access Token" works. The key ends up in the built app, so make one just for this.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run dev:lan` | Same, reachable from your phone on the same Wi-Fi (no install/offline: that needs HTTPS) |
| `npm test` | Unit tests (ranking maths, binary insertion, date grouping, backup validation) |
| `npm run build` | Type-check and build to `dist/` |
| `npm run icons` | Regenerate the PNG icons from `public/logo.svg` |

## Deploying

`dist/` is plain static files. Installing to the home screen needs HTTPS, so test installs from a deployed copy:

- **Netlify / Vercel:** build command `npm run build`, output `dist`, and add `VITE_TMDB_KEY` as an environment variable.
- **GitHub Pages (project site):** build with `npm run build -- --base=/<repo-name>/`.

Routing is hash-based (`#/rankings`), so no rewrite rules are needed anywhere.

## Installing

- **iPhone:** open the link in Safari → Share → Add to Home Screen.
- **Android:** open the link in Chrome → Install app (Settings in the app also shows an Install button when Chrome offers one).

## How it's put together

```
src/
  db.ts                 Dexie schema: shows, episodes, rankings, meta
  lib/tmdb.ts           Search, details, external IDs, streaming providers
  lib/tvmaze.ts         IMDb → TVmaze lookup, episode schedules (with 429 back-off)
  lib/shows.ts          Follow/unfollow, per-show refresh, 12-hour stale refresh queue
  lib/ranking.ts        Scores, binary-insertion steps, placing/removing shows in buckets
  lib/dates.ts          Today / This week / Later grouping, local-time formatting
  lib/backup.ts         Export (share sheet or download), validated import
  lib/router.ts         Tiny hash router (Android back button works)
  screens/              Upcoming, Rankings, Search, Settings, ShowDetail, RankFlow
```

A few choices the spec left open:

- **Later** shows only each show's *next* episode, so a fully scheduled season doesn't flood the list. Today and This week show everything.
- Episodes of one show that drop at the same moment (a Netflix-style season release) collapse into one row: "S2 E1–8 · 8 episodes".
- Only episodes from the last two days onward are stored. Nothing displays older ones, and it keeps backups small.
- "Too close to call" places the show directly below the one it was compared with.
- Re-ranking keeps the old position until the new one is confirmed, so backing out changes nothing.
- Unfollowing a show that isn't ranked deletes it from the device; a ranked show keeps its record.
- The streaming region comes from the phone's language setting (e.g. `en-GB` → GB), falling back to US.
