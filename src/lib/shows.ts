import { db, type Show } from '../db'
import { getShowDetails, type ShowDetails } from './tmdb'
import { getEpisodes, lookupTvmazeId, sleep } from './tvmaze'
import { createStore } from './store'
import { errorMessage } from './toast'

export const STALE_MS = 12 * 60 * 60 * 1000
const DELAY_BETWEEN_SHOWS_MS = 600

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
  })
  await refreshShow(tmdbId, details)
}

export async function unfollow(tmdbId: number) {
  await db.transaction('rw', db.shows, db.episodes, db.rankings, async () => {
    await db.episodes.where('tmdb_show_id').equals(tmdbId).delete()
    // Keep the record if it's ranked; otherwise there's no reason to hold on to it.
    if (await db.rankings.get(tmdbId)) await db.shows.update(tmdbId, { followed: false, followed_at: null })
    else await db.shows.delete(tmdbId)
  })
}

/** Pull fresh show info from TMDB and the episode schedule from TVmaze. */
export async function refreshShow(tmdbId: number, prefetched?: ShowDetails) {
  const show = await db.shows.get(tmdbId)
  if (!show?.followed) return
  const details = prefetched ?? (await getShowDetails(tmdbId, { fresh: true }))
  const tvmazeId = show.tvmaze_id ?? (await lookupTvmazeId(details.show.imdb_id, details.tvdb_id))
  const episodes = tvmazeId ? await getEpisodes(tvmazeId, tmdbId) : []

  await db.transaction('rw', db.shows, db.episodes, async () => {
    const current = await db.shows.get(tmdbId)
    if (!current?.followed) return // unfollowed while we were fetching
    await db.episodes.where('tmdb_show_id').equals(tmdbId).delete()
    await db.episodes.bulkPut(episodes)
    await db.shows.put({ ...current, ...details.show, tvmaze_id: tvmazeId, last_refreshed_at: new Date().toISOString() })
  })
}

export const refreshStore = createStore<{ running: boolean; error: string | null }>({ running: false, error: null })
let inFlight: Promise<void> | null = null

const isStale = (s: Show) => !s.last_refreshed_at || Date.now() - Date.parse(s.last_refreshed_at) > STALE_MS

/**
 * Refresh followed shows one at a time, with a pause between each to respect rate limits.
 * By default only shows older than 12 hours; `force` refreshes everything.
 */
export function refreshFollowed({ force = false } = {}): Promise<void> {
  if (inFlight) return inFlight
  if (!navigator.onLine) return Promise.resolve()

  inFlight = (async () => {
    const shows = (await db.shows.toArray()).filter((s) => s.followed && (force || isStale(s)))
    if (shows.length === 0) return
    refreshStore.set({ running: true, error: null })
    let error: string | null = null
    for (let i = 0; i < shows.length; i++) {
      try {
        await refreshShow(shows[i].tmdb_id)
      } catch (err) {
        error = errorMessage(err)
        if (!navigator.onLine) break
      }
      if (i < shows.length - 1) await sleep(DELAY_BETWEEN_SHOWS_MS)
    }
    refreshStore.set({ running: false, error })
  })().finally(() => {
    inFlight = null
    if (refreshStore.get().running) refreshStore.set({ running: false, error: refreshStore.get().error })
  })
  return inFlight
}
