# Show Tracker

A minimalist personal TV tracker, installable as a PWA: **what's coming up** for the shows you follow, and **comparison-based (Elo) rankings** for the shows you've watched. All data stays on the phone (IndexedDB). See [show-tracker-spec.md](show-tracker-spec.md) for the full spec.

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
  lib/elo.ts            Elo maths: ratings ↔ scores, updates, picking the next comparison
  lib/ranking.ts        Saving and removing rankings, sort order
  lib/dates.ts          Today / This week / Later grouping, local-time formatting
  lib/backup.ts         Export (share sheet or download), validated import
  lib/router.ts         Tiny hash router (Android back button works)
  screens/              Upcoming, Rankings, Search, Settings, ShowDetail, RankFlow
```

A few choices the spec left open:

- **On air** lists every episode airing today and this week, so a show with more than one episode can appear more than once. **Later** shows only each show's *next* episode (and not at all if it's already listed this week), so a fully scheduled season doesn't flood the list.
- Episodes of one show that drop at the same moment (a Netflix-style season release) collapse into one row: "S2 E1–8 · 8 episodes".
- Every episode of a followed show is stored (past and future), so past episodes can be ticked as watched. Ticks are kept in their own table keyed by show/season/episode, survive refreshes and unfollowing, and are included in backups (current backup format is v3; older files still import).
- **Rankings use Elo.** Pick Liked it / It was fine / Didn't like it (which sets a starting rating in the middle of that bucket), then answer up to 6 "Which was better?" questions against your closest-rated ranked shows. Each answer moves both shows' ratings; "Too close to call" is a draw. A rating of 1500 is a 5.0 and every 100 points is one point of score, kept inside the bucket's range (Liked 6.8–10, Fine 3.4–6.7, Didn't like 0–3.3). "Compare more" fine-tunes a ranked show; picking a bucket again starts it over. Shows you've ticked episodes of but not ranked appear under "Ready to rank".
- Nothing is saved until the last question is answered, so backing out of a ranking changes nothing. Rankings from before the Elo switch convert straight to ratings with the same scores.
- **Own on DVD / Own on streaming** ticks live on each show page and are included in backups. Ticking a show you don't follow saves it.
- A show is kept on the device while it's followed, ranked or owned; once none of those apply, it's deleted.
- **Where to stream** is per country. Each phone guesses its region from the language setting (`en-GB` → United Kingdom) and can override it in Settings → Streaming region. Subscription services are listed first, then free ones (BBC iPlayer, ITVX…), then ad-supported; rent/buy is left out. Store variants like "Netflix Standard with Ads" are folded into the main service, and only the first six show until you tap "Show more".
- **Upcoming** has two views. **On air** is the schedule; a show you have started but are behind on shows "N to catch up". **Off air** lists followed shows with nothing scheduled: **Up next** (your next unwatched episode, with a tick to mark it), **Not started**, and **Caught up** with what TMDB knows about the next season ("Season 3 announced, no date yet").
- The **Shows** tab lists everything you follow A–Z with where you are up to. **Not started** is automatic (no episodes ticked). **Finished** shows (ended or cancelled, every episode ticked) move out of Following into their own filter. **Hide caught up** hides shows you are up to date on that are still coming back.
