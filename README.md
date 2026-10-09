# Show Tracker

A minimalist personal TV tracker, installable as a PWA: **what's coming up** for the shows you follow, and **Beli-style rankings** for the shows you've watched. All data stays on the phone (IndexedDB). See [show-tracker-spec.md](show-tracker-spec.md) for the full spec.

## Setup

```bash
npm install
npm run dev
```

### TMDB key

Each phone stores its own TMDB key. The app asks for one on the Search screen (and in Settings). It's checked with TMDB before saving, kept only in that phone's IndexedDB, and left out of backups. The deployed site never contains a key, so the repo and hosting can be public.

Get a free key at themoviedb.org → Settings → API. Either the v3 "API Key" or the v4 "API Read Access Token" works. Two people can each use their own, or paste the same one into both phones.

For local development you can skip pasting by copying `.env.example` to `.env` and setting `VITE_TMDB_KEY`. Only `npm run dev` reads it; production builds ignore it.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run dev:lan` | Same, reachable from your phone on the same Wi-Fi (no install/offline: that needs HTTPS) |
| `npm test` | Unit tests (ranking maths, binary insertion, date grouping, backup validation) |
| `npm run build` | Type-check and build to `dist/` |
| `npm run icons` | Regenerate the PNG icons from `public/logo.svg` |

## Deploying

`dist/` is plain static files. Installing to the home screen needs HTTPS, so test installs from a deployed copy:

- **Netlify / Vercel:** build command `npm run build`, output `dist`. No environment variables needed.
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
- Every episode of a followed show is stored (past and future), so past episodes can be ticked as watched. Ticks are kept in their own table keyed by show/season/episode, survive refreshes and unfollowing, and are included in backups (backup format v2; v1 files still import).
- "Too close to call" places the show directly below the one it was compared with.
- Re-ranking keeps the old position until the new one is confirmed, so backing out changes nothing.
- **Own on DVD / Own on streaming** ticks live on each show page and are included in backups. Ticking a show you don't follow saves it.
- A show is kept on the device while it's followed, ranked or owned; once none of those apply, it's deleted.
- **Where to stream** is per country. Each phone guesses its region from the language setting (`en-GB` → United Kingdom) and can override it in Settings → Streaming region. Subscription services are listed first, then free ones (BBC iPlayer, ITVX…), then ad-supported; rent/buy is left out. Store variants like "Netflix Standard with Ads" are folded into the main service, and only the first six show until you tap "Show more".
- **Upcoming** has two views. **On air** is the schedule; a show you have started but are behind on shows "N to catch up". **Off air** lists followed shows with nothing scheduled: **Up next** (your next unwatched episode, with a tick to mark it), **Not started**, and **Caught up** with what TMDB knows about the next season ("Season 3 announced, no date yet").
- The **Shows** tab lists everything you follow A–Z with where you are up to, plus **Not started** and **Owned** filters and a **Hide caught up** tick box. "Not started" is automatic: a show with no episodes ticked.
