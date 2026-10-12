# Show Tracker

A minimalist personal TV tracker, installable as a PWA: **what's coming up** for the shows you follow, and **comparison-based (Elo) rankings** for the shows you've watched. There's no server: all data stays on the phone (IndexedDB), and TMDB and TVmaze are called straight from the browser.

**Live:** https://show-tracker-zeta.vercel.app

- **Tracking**: *Watching* (Up next, Not started, Caught up) and *On air* (Today, This week, Later, plus Save the Date and Still Cooking)
- **Shows**: everything you follow, with Not started, Able to stream and Finished filters
- **Rankings**: Liked it / It was fine / Didn't like it, then "Which was better?" questions, plus Keep comparing
- **Episodes**: tick what you've watched, with time watched and overall stats
- **Streaming**: where to stream in your country, your own services, and Own on DVD / streaming
- **Offline-ready**, with backups (settings included) and a light/dark theme

[show-tracker-spec.md](show-tracker-spec.md) is the original spec; the app has grown since, and the notes below describe how it works now.

## Setup

```bash
npm install
npm run dev
```

### TMDB key

Each phone stores its own TMDB key. The app asks for one on the Search screen (and in Settings). It's checked with TMDB before saving, kept only in that phone's IndexedDB, and left out of backups. The deployed site never contains a key, so the repo and hosting can be public.

Get it free at themoviedb.org → Settings → API: use the long **API Read Access Token** (v4), which is sent in a request header. The shorter v3 "API Key" goes in the URL, so the app no longer accepts it for new saves (keys saved earlier still work, with a nudge in Settings to switch). Two people can each use their own, or paste the same one into both phones.

For local development you can skip pasting by copying `.env.example` to `.env` and setting `VITE_TMDB_KEY`. Only `npm run dev` reads it; production builds ignore it.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run dev:lan` | Same, reachable from your phone on the same Wi-Fi (no install/offline: that needs HTTPS) |
| `npm test` | Tests: the maths (Elo, dates, progress, backup checks) and the saved-data code (follow/unfollow, rankings, Keep comparing, rate prompt, backups, refresh, database upgrades) against an in-memory database |
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
  lib/backup.ts         Export (share sheet on iPhone, download elsewhere), validated import
  lib/router.ts         Tiny hash router (Android back button works)
  screens/              Tracking, Shows, Rankings, Search, Settings, ShowDetail, RankFlow
```

A few choices the spec left open:

- **On air** lists every episode airing today and this week, so a show with more than one episode can appear more than once. **Later** runs up to 3 months out and shows only each show's *next* episode. Anything further away sits in a closed **Save the Date** section at the bottom; TMDB premiere dates count here even before TVmaze lists the episodes (e.g. a season a year out).
- Episodes of one show that drop at the same moment (a Netflix-style season release) collapse into one row: "S2 E1–8 · 8 episodes".
- Every episode of a followed show is stored (past and future), so past episodes can be ticked as watched. Ticks are kept in their own table keyed by show/season/episode, survive refreshes and unfollowing, and are included in backups (current backup format is v4; older files still import).
- **Rankings use Elo.** Pick Liked it / It was fine / Didn't like it (which sets a starting rating in the middle of that bucket), then answer "Which was better?" questions against your closest-rated ranked shows: 6 by default, or 10, 15 or All (every ranked show) under Settings → Ranking. The first 6 answers move a new show in big steps, later ones in smaller steps, and "Stop here and save" ends a session early. Each answer moves both shows' ratings; "Too close to call" is a draw. A rating of 1500 is a 5.0 and every 100 points is one point of score, kept inside the bucket's range (Liked 6.8–10, Fine 3.4–6.7, Didn't like 0–3.3). If your answers push the show's rating past its bucket, it asks before saving whether to move it to the bucket that fits ("Move to Liked · 7.3" or "Keep in Fine · 6.7"). "Compare more" fine-tunes a ranked show; picking a bucket again starts it over. Shows you've ticked episodes of but not ranked appear under "Ready to rank".
- Nothing is saved until the last question is answered, so backing out of a ranking changes nothing. Rankings from before the Elo switch convert straight to ratings with the same scores.
- **Own on DVD / Own on streaming** ticks live on each show page and are included in backups. Ticking a show you don't follow saves it.
- A show is kept on the device while it's followed, ranked or owned; once none of those apply, it's deleted.
- **Where to stream** is per country. Each phone guesses its region from the language setting (`en-GB` → United Kingdom) and can override it in Settings → Streaming region. Subscription services are listed first, then free ones (BBC iPlayer, ITVX…), then ad-supported; rent/buy is left out. Store variants like "Netflix Standard with Ads" are folded into the main service, and only the first six show until you tap "Show more".
- The first tab is **Tracking**, with two views. **Watching** (the default) is every show you're tracking, by where you're up to, airing or not (e.g. season 1 while season 2 airs): **Up next** (your next episode to watch, with a tick), then two closed drop-downs: **Not started** (with a tick for episode 1) and **Caught up** (with the next episode or season if known). Shows that are currently airing get a **Still airing** pill. Finished and stopped shows are left out. **On air** is the schedule for the next 3 months: Today / This week / Later. Aired episodes have a tick; ticked ones drop off. Closed sections at the bottom: **Save the Date** (more than 3 months away) and **Still Cooking** (in production, no date yet), each showing how many episodes you have to catch up on.
- **Settings → On air** picks which shows appear on the schedule: **All shows** (the default) or **Current season**, which hides a show you're a whole season behind on (e.g. 2 episodes left of season 2 while season 3 airs) until you catch up. Being a few episodes behind in the current season is fine. The current season goes by episodes aired before today, so a premiere doesn't hide a show on the day. A note says how many are hidden. Included in backups.
- **Settings → Tracking opens on** picks the view the Tracking tab starts on: **Watching** (the default) or **On air**. Switching views sticks while the app is open (going to another tab and back keeps it); opening the app again starts on the default. Included in backups.
- **Long titles** wrap onto two lines in lists instead of being cut off, and the show page title steps down a size for longer names (e.g. "The Lord of the Rings: The Rings of Power") so the poster keeps its size on phones.
- "Next to watch" is the episode after the furthest one you've ticked, so episodes skipped before it (or never ticked because you watch live) don't count as still to watch.
- The **Shows** tab lists every show you follow A–Z with where you're up to, finished ones included ("Ended · watched all 73 episodes"); that's the default with no filter selected. The quick filters are **Able to stream**, **Not started** (automatic: no episodes ticked) and **Finished** (ended or cancelled, every episode ticked). Tap a selected filter again to go back to everything. The chips have no counts so they fit on one line without scrolling; the number of shows in the current list sits underneath.
- **Watched all episodes** is a switch on each show page. Switching it off straight after switching it on restores exactly what was ticked before; otherwise it asks before unticking everything. On a show you don't follow, it follows the show first (that's what loads its episode list).
- **Appearance** in Settings picks System, Light or Dark. It's stored in localStorage so `public/theme-init.js` can apply it before the first paint (no flash), and it's included in backups.
- **Stopped watching** is a tick box on a followed show's page. The show stays in Shows (marked "Stopped watching") and keeps its ranking, but never appears on Tracking. Following it again clears it.
- The show page has a **progress pill** above Follow / Rank: "16 episodes left", "Caught up", "Finished", "Not started · 19 episodes" or "Stopped watching". Tapping it jumps to the episode list.
- In **Search**, **+** opens a pop-up: **Start tracking** (follow it) or **Watched it all** (follow it, tick every aired episode, then go straight into rating it).
- **Time watched** on a show's Episodes section adds up the runtimes of ticked episodes ("3d 5h watched · 3d 4h to go"). Runtimes come from TMDB where it has them (real lengths, e.g. 43 min), otherwise TVmaze (often the TV slot, e.g. 60). Each episode is looked up once; episodes with no runtime count as the show's average.
- **Your stats** at the top of Settings adds up episodes watched, time watched and shows finished (ended and fully watched) across every show.
- **Security headers** live in `vercel.json` (Content-Security-Policy limiting scripts to the app and connections to TMDB/TVmaze, no framing, nosniff, no referrer, and a locked-down Permissions-Policy). `npm run preview` sends the same headers so they can be tested locally. The light/dark script is a file (`public/theme-init.js`) rather than inline, so the policy can stay `script-src 'self'`.
- **Poster cache**: TMDB images are loaded with CORS and a `?cors` marker on the URL, so the offline cache stores them at their real size (opaque responses count as ~7 MB each against the storage quota). The marker matters because TMDB doesn't send `Vary: Origin`, so copies cached by older, non-CORS loads would otherwise be reused and fail.
- **Export backup** uses the share sheet on iPhone (Save to Files / iCloud Drive) and a plain download everywhere else. Chrome on Android offers the share sheet for files but refuses .json ones, so sharing there never worked; the file now lands in Downloads.
- A **safety-net screen** (error boundary) replaces a blank page if something crashes, with Reload and Export backup.
- Unfollowing a show you've **ticked episodes of** keeps its record and episode list, so its history and time stay in Your stats.
- Ticking the episode that **finishes** an unranked show offers to rate it.
- **Keep comparing** (Rankings tab) serves random pairs of ranked shows. Each answer is saved immediately and moves both ratings (K = 24); Undo and Skip are there too. Each pair comes up only once per session (answered or skipped); once every pair has been used, it says so and offers to find a show to rank. Leaving and coming back starts a new session.
- **Streaming services** (Settings) is a tick list of the services you have. It lists the services your followed shows are on (with how many shows each), and "More services" loads TMDB's full list for your region (rent/buy stores left out). Variants count as the main service ("Netflix Standard with Ads" is Netflix, "Paramount+ Amazon Channel" is Paramount Plus). Included in backups.
- **Able to stream** (Shows tab) lists the shows you follow that are on one of your ticked services, plus any you own on DVD or streaming, with a line saying where ("Netflix · Own on DVD").
- **Vercel Web Analytics** (`@vercel/analytics`, production builds only) counts page views per screen. URLs are rewritten before sending so hash routes count as screens and show IDs are left out (`/#/show/2710` → `/show/[id]`). The script and its endpoint are served from the site itself (`/_vercel/insights/…`), so the CSP is unchanged. Turn it on under the Vercel project's Analytics tab; until then the script 404s harmlessly. Settings → About mentions it.
- **If TVmaze stops recognising a show** (shows sometimes get merged or re-added there), a refresh looks it up again instead of wiping its episode list; with no match at all, the episodes it already has are kept.
- **Backups include your settings** (format v4): streaming region, streaming services, On air, Tracking opens on, ranking questions and theme, so a new phone (or an iPhone reinstall) is set up in one go. The TMDB token is never included. Older backups have no settings, so restoring one leaves this phone's settings alone.
- **Backups don't include "Where to stream"**: it changes all the time, so it always comes fresh from TMDB (on each refresh of followed shows, and live on the show page for others). Older backups that contain it have it ignored.

## Licence

MIT. See [LICENSE](LICENSE). Show data and images come from TMDB and TVmaze under their own terms (see Settings → About in the app).
