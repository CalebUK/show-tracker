import { db, hasTicks, isOwned, type Episode, type Show } from '../db'
import { localMidnight } from './dates'
import { getShowDetails, getTmdbEpisodes, getTmdbKey, type ShowDetails } from './tmdb'
import { getEpisodes, lookupTvmazeId } from './tvmaze'
import { createStore } from './store'
import { errorMessage } from './toast'

export const STALE_MS = 12 * 60 * 60 * 1000
/** Ended, cancelled and stopped shows rarely change, so they're refreshed monthly. */
export const QUIET_STALE_MS = 30 * 24 * 60 * 60 * 1000
/** Shows refreshed at once. TVmaze calls are spaced out in tvmaze.ts, so this mainly overlaps the waiting. */
const REFRESH_AT_ONCE = 4

function fromDetails(details: ShowDetails): Show {
  return { ...details.show, tvmaze_id: null, followed: false, followed_at: null, last_refreshed_at: null }
}

/** The stored show if we have it, otherwise one built from TMDB (not saved). */
export async function loadShow(tmdbId: number): Promise<Show> {
  return (await db.shows.get(tmdbId)) ?? fromDetails(await getShowDetails(tmdbId))
}

export async function follow(tmdbId: number) {
  const details = await getShowDetails(tmdbId)
  const existing = await db.shows.get(tmdbId)
  await db.shows.put({
    ...(existing ?? fromDetails(details)),
    ...details.show,
    followed: true,
    followed_at: new Date().toISOString(),
    // Following again means tracking again.
    stopped: false,
  })
  await refreshShow(tmdbId, details)
}

export async function unfollow(tmdbId: number) {
  await db.transaction('rw', [db.shows, db.episodes, db.rankings, db.watched], async () => {
    const show = await db.shows.get(tmdbId)
    if (!show) return
    // If you've ticked any of it, keep the episode list so its watch history (and time in
    // Your stats) survives. Otherwise the episodes are only needed while following.
    const ticked = await hasTicks(tmdbId)
    if (!ticked) await db.episodes.where('tmdb_show_id').equals(tmdbId).delete()
    // Keep the record if it's ticked, ranked or owned; otherwise there's no reason to hold on to it.
    if (ticked || isOwned(show) || (await db.rankings.get(tmdbId))) await db.shows.update(tmdbId, { followed: false, followed_at: null })
    else await db.shows.delete(tmdbId)
  })
}

/** "Stopped watching": keep following (Shows, Rankings) but hide the show from Tracking. */
export async function setStopped(tmdbId: number, stopped: boolean) {
  await db.shows.update(tmdbId, { stopped })
}

/** "Exclude from rating": keep it out of Ready to rank, the rate prompt, and other shows' comparisons. */
export async function setExcludedFromRating(tmdbId: number, excluded: boolean) {
  await db.shows.update(tmdbId, { exclude_from_rating: excluded })
}

/** Who's watching: one of your people, or null for you. */
export async function setPerson(tmdbId: number, personId: string | null) {
  await db.shows.update(tmdbId, { person: personId ?? undefined })
}

/** Tick or untick "Own on DVD" / "Own on streaming". Saves the show if it isn't stored yet. */
export async function setOwned(tmdbId: number, field: 'own_dvd' | 'own_streaming', value: boolean) {
  const show = await loadShow(tmdbId)
  await db.transaction('rw', [db.shows, db.rankings, db.watched], async () => {
    const next: Show = { ...((await db.shows.get(tmdbId)) ?? show), [field]: value }
    if (next.followed || isOwned(next) || (await db.rankings.get(tmdbId)) || (await hasTicks(tmdbId))) await db.shows.put(next)
    else await db.shows.delete(tmdbId)
  })
}

/** Pull fresh show info from TMDB and the episode schedule from TVmaze. */
export async function refreshShow(tmdbId: number, prefetched?: ShowDetails) {
  const show = await db.shows.get(tmdbId)
  if (!show?.followed) return
  const details = prefetched ?? (await getShowDetails(tmdbId, { fresh: true }))
  const lookup = () =>
    lookupTvmazeId(details.show.imdb_id, details.tvdb_id, { name: details.show.name, firstAired: details.first_air_date })
  let tvmazeId = show.tvmaze_id ?? (await lookup())
  let episodes = tvmazeId ? await getEpisodes(tvmazeId, tmdbId) : null
  // TVmaze no longer knows the saved id (shows get merged or re-added): look the show up again.
  if (!episodes && show.tvmaze_id) {
    tvmazeId = await lookup()
    episodes = tvmazeId ? await getEpisodes(tvmazeId, tmdbId) : null
  }
  if (episodes) {
    await addTmdbDetails(tmdbId, episodes)
    // No date from TVmaze or TMDB yet: leave it out until there is one.
    episodes = episodes.filter((e) => e.airstamp)
  }

  await db.transaction('rw', db.shows, db.episodes, async () => {
    const current = await db.shows.get(tmdbId)
    if (!current?.followed) return // unfollowed while we were fetching
    // No list from TVmaze: keep the episodes we have rather than wiping them, and look the
    // show up again next time.
    if (episodes) {
      await db.episodes.where('tmdb_show_id').equals(tmdbId).delete()
      await db.episodes.bulkPut(episodes)
    }
    await db.shows.put({ ...current, ...details.show, tvmaze_id: episodes ? tvmazeId : null, last_refreshed_at: new Date().toISOString() })
  })
}

/** Whether a refresh is running, how far it's got (`done` of `total` shows), and the last error. */
export const refreshStore = createStore<{ running: boolean; error: string | null; done: number; total: number }>({
  running: false,
  error: null,
  done: 0,
  total: 0,
})
let inFlight: Promise<void> | null = null

const isQuiet = (s: Show) => s.stopped === true || s.status === 'Ended' || s.status === 'Canceled'

/**
 * Whether a show is due a refresh. Ended, cancelled and stopped shows: once a month, even when
 * `force`d (a pull-to-refresh). Everything else: after 12 hours, or whenever `force`d.
 */
export function isDue(s: Show, force: boolean, now = Date.now()) {
  if (!s.last_refreshed_at) return true
  const age = now - Date.parse(s.last_refreshed_at)
  return isQuiet(s) ? age > QUIET_STALE_MS : force || age > STALE_MS
}

/**
 * Refresh followed shows that are due (see isDue), a few at a time (TVmaze's rate limit is
 * respected in tvmaze.ts).
 */
export function refreshFollowed({ force = false } = {}): Promise<void> {
  if (inFlight) return inFlight
  if (!navigator.onLine || !getTmdbKey()) return Promise.resolve()

  inFlight = (async () => {
    const shows = (await db.shows.toArray()).filter((s) => s.followed && isDue(s, force))
    if (shows.length === 0) return
    const total = shows.length
    let next = 0
    let done = 0
    let error: string | null = null
    let stop = false
    refreshStore.set({ running: true, error: null, done, total })
    const worker = async () => {
      while (!stop && next < total) {
        const show = shows[next++]
        try {
          await refreshShow(show.tmdb_id)
        } catch (err) {
          error = errorMessage(err)
          if (!navigator.onLine) stop = true
        }
        refreshStore.set({ running: true, error: null, done: ++done, total })
      }
    }
    await Promise.all(Array.from({ length: Math.min(REFRESH_AT_ONCE, total) }, worker))
    refreshStore.set({ running: false, error, done, total })
  })().finally(() => {
    inFlight = null
    if (refreshStore.get().running) refreshStore.set({ ...refreshStore.get(), running: false })
  })
  return inFlight
}

/**
 * Fetch the latest "where to stream" (and TMDB's other show details, like status) for every show
 * you follow, without the episode lists, so it's TMDB only and quick. Ended and stopped shows
 * otherwise only update monthly. Also used after changing region or restoring a backup.
 * Returns how many shows couldn't be updated.
 */
export async function refreshStreaming(onProgress?: (done: number, total: number) => void): Promise<number> {
  const shows = (await db.shows.toArray()).filter((s) => s.followed)
  let next = 0
  let done = 0
  let failed = 0
  onProgress?.(0, shows.length)
  const worker = async () => {
    while (next < shows.length) {
      const id = shows[next++].tmdb_id
      try {
        const { tmdb_id, ...fields } = (await getShowDetails(id, { fresh: true })).show
        await db.shows.update(id, fields)
      } catch {
        failed++
      }
      onProgress?.(++done, shows.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(REFRESH_AT_ONCE, shows.length) }, worker))
  return failed
}

/**
 * Fill in from TMDB what TVmaze's list lacks, in one request:
 * - Air dates for episodes TVmaze hasn't dated (airstamp ''), e.g. a whole season dropped at once.
 *   TMDB only has the day, so they're set to local midnight without a time.
 * - Real runtimes (e.g. 43) for TVmaze's TV slot (e.g. 60). Episodes already checked keep theirs, so
 *   only seasons with newly aired episodes are asked about.
 * Mutates `episodes`. If TMDB can't be reached, nothing changes and it tries again next refresh.
 */
async function addTmdbDetails(tmdbId: number, episodes: Episode[]) {
  const previous = new Map((await db.episodes.where('tmdb_show_id').equals(tmdbId).toArray()).map((e) => [`${e.season}:${e.number}`, e]))
  const now = Date.now()
  const seasons = new Set<number>()
  for (const e of episodes) {
    if (e.number == null || e.season < 1) continue
    const before = previous.get(`${e.season}:${e.number}`)
    if (!e.airstamp) seasons.add(e.season)
    else if (before?.runtime_checked) {
      e.runtime = before.runtime
      e.runtime_checked = true
    } else if (Date.parse(e.airstamp) <= now) seasons.add(e.season)
  }
  if (!seasons.size) return
  try {
    const tmdb = await getTmdbEpisodes(tmdbId, [...seasons])
    for (const e of episodes) {
      if (e.number == null || !seasons.has(e.season)) continue
      const info = tmdb.get(`${e.season}:${e.number}`)
      if (!e.airstamp && info?.air_date) {
        e.airstamp = localMidnight(info.air_date)
        e.has_time = false
      }
      if (!e.airstamp || e.runtime_checked) continue
      e.runtime = info?.runtime ?? e.runtime
      // Only aired episodes count as checked; TMDB often fills in runtimes after an episode airs.
      if (Date.parse(e.airstamp) <= now) e.runtime_checked = true
    }
  } catch {
    // Keep what TVmaze gave for now.
  }
}
