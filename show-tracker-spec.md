# Show Tracker: Build Spec

A minimalist personal TV show tracker. Two jobs only:

1. **What's coming up** for the shows I follow.
2. **How I rank** the shows I've watched, using a Beli-style comparison system.

No social feed, no movies, no recommendations, no clutter.

**Who it's for:** two people, one on iPhone and one on Android. Each phone keeps its own shows and rankings; nothing is shared or synced.

---

## Architecture

- **No server, no database.** A static web app (PWA) installed to the home screen.
- All data stored **on the device** in IndexedDB.
- The app calls TMDB and TVmaze **directly from the browser**.
- Hosted as static files (Vercel, Netlify, GitHub Pages or a home NAS; any static host works).

### Installing
- **iPhone:** open the link in Safari → Share → Add to Home Screen.
- **Android:** open the link in Chrome → Install app (or menu → Add to Home screen).

The app must open full screen with its own icon on both.

---

## Design direction

- Minimalist. Lots of whitespace, one accent colour, posters do the visual work.
- Two main screens: **Upcoming** (home) and **Rankings**. A search bar to add shows. A small settings screen for backup. That's it.
- Mobile-first; must feel native on both iPhone and Android.
- Respect safe areas (notch, home indicator) on iPhone.
- Dark mode follows the system setting.
- No dashboards, badges, streaks or stats pages.

---

## Suggested stack

- **Vite + React + TypeScript**
- **Tailwind CSS**
- **Dexie** (IndexedDB wrapper) for all storage
- **vite-plugin-pwa** for the manifest, icons and service worker

---

## Data sources (free)

| Source | Use it for | Notes |
|---|---|---|
| **TMDB API** | Show search, posters, overview, season info, IMDb ID, where to stream | Free API key for non-commercial use. Check current terms. Must show TMDB attribution in the app. |
| **TVmaze API** | Episode air dates and schedules | Free, no key needed. Rate-limited, so cache responses and space out requests. |

**IMDb:** no free API. Don't scrape it. Use the `imdb_id` from TMDB to link out to the IMDb page.

### API key
- TMDB key goes in `.env` as `VITE_TMDB_KEY`. It will be visible in the built app; that's accepted for this personal, read-only use. Use a key dedicated to this app only.

### Linking the two
1. User searches → TMDB search endpoint.
2. On follow, fetch TMDB external IDs to get `imdb_id`.
3. Use TVmaze's lookup endpoint with that IMDb ID to get the TVmaze show ID.
4. Store both IDs on the show record.

---

## Data model (IndexedDB via Dexie)

```
shows
  tmdb_id           (primary key)
  tvmaze_id
  imdb_id
  name
  poster_path
  overview
  status            (returning / ended / in production / etc.)
  network
  streaming         (list of providers, optional)
  followed          (boolean)
  followed_at
  last_refreshed_at

episodes
  id                (TVmaze episode id)
  tmdb_show_id      (indexed)
  season
  number
  name
  airstamp          (ISO timestamp in UTC, indexed)

rankings
  tmdb_show_id      (primary key)
  bucket            ("liked" | "fine" | "disliked")
  position          (integer order within bucket; 0 = best)
  score             (decimal 0.0–10.0, derived, never entered)
  ranked_at
```

A show can be ranked without being followed (e.g. finished series).

---

## Feature 1: Upcoming (home screen)

- Upcoming episodes for followed shows, grouped: **Today**, **This week**, **Later**.
- Each row: poster thumbnail, show name, S/E number, episode title, air date/time in the **device's local time zone**.
- Small section at the bottom: "Returning, no date yet" for followed shows with no scheduled episodes but status still returning.
- Tap a show → simple detail view: poster, overview, next episode, where to stream, IMDb link, Unfollow button, Rank button.

### Keeping it up to date (no server)
- On app open (and when it returns to the foreground), refresh any followed show whose `last_refreshed_at` is older than **12 hours**.
- Show cached data instantly; refresh quietly in the background and update the list when done.
- Refresh shows one at a time with a short delay to respect rate limits.
- Pull-to-refresh forces a refresh of everything.
- If offline, show cached data with a subtle "offline" note.

---

## Feature 2: Beli-style rankings

The user never types a score. Scores come from where a show lands in an ordered list.

### Flow
1. User taps **Rank** on a show (from search or detail view).
2. Pick a bucket: **Liked it / It was fine / Didn't like it**.
3. If the bucket has other shows, ask a series of "Which was better?" comparisons, two posters side by side.
4. Use **binary search** to place it. Each answer halves the range, so 100 shows needs only about 7 comparisons.
5. Insert at that position, then recalculate scores for the bucket.

### Binary insertion (pseudocode)
```
low = 0
high = bucket.length
while low < high:
    mid = floor((low + high) / 2)
    if userPrefers(newShow, bucket[mid]):
        high = mid       # new show is better; search upper half
    else:
        low = mid + 1    # new show is worse; search lower half
insert newShow at index low
```

### Score calculation
| Bucket | Range |
|---|---|
| Liked | 6.8 – 10.0 |
| Fine | 3.4 – 6.7 |
| Didn't like | 0.0 – 3.3 |

Within a bucket, spread shows evenly from top to bottom of its range:

```
if bucket has 1 show:   score = top of range
else: score = top - (position / (count - 1)) * (top - bottom)
```

Round to one decimal. Recalculate all scores in a bucket whenever a show is inserted, moved or removed.

### Extras (only if cheap)
- Re-rank: remove the show and run the comparison flow again.
- "Too close to call" button during comparisons: place it next to the compared show.

### Rankings screen
- One clean list, highest score first: score, poster, name.
- Filter chips for the three buckets. Nothing more.

---

## Feature 3: Backup (required for v1)

Data lives only on the phone, so deleting the app or clearing browser data loses everything.

- Settings screen with **Export backup** and **Import backup**.
- Export: all shows, episodes and rankings as one JSON file, named like `show-tracker-backup-2026-10-09.json`. Use the share sheet / download so it can be saved to iCloud Drive or Google Drive.
- Import: pick a JSON file, validate it, confirm before replacing current data.
- Optional: a gentle reminder on the settings screen showing when the last backup was made.
- Request persistent storage (`navigator.storage.persist()`) on first launch to reduce the chance of the browser clearing data.

---

## Build phases

Build and test one phase at a time.

1. **Setup:** Vite + React + TS + Tailwind, Dexie schema, TMDB key in `.env`, base layout and theme.
2. **PWA:** manifest, icons, service worker, full-screen mode. Test installing on iPhone and Android early.
3. **Search & follow:** TMDB search, follow/unfollow, ID linking to TVmaze.
4. **Upcoming screen:** fetch and store episodes, grouped upcoming list, show detail view.
5. **Refresh-on-open:** stale check, background refresh, pull-to-refresh, offline state.
6. **Rankings:** bucket picker, comparison screen, binary insertion, scores, rankings list.
7. **Backup:** export/import JSON, persistent storage request.
8. **Polish:** loading/empty states, TMDB attribution, safe areas, test on both phones.

---

## Later (out of scope for v1)
- Web push notifications for new episodes (supported on iPhone for home-screen apps and on Android)
- Syncing across devices
- Wrapping as a native app
