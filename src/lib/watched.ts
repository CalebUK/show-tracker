import { db, episodeKey, type Episode } from '../db'
import { isAired } from './progress'
import { offerRatingIfFinished } from './ratePrompt'
import { follow } from './shows'

/**
 * "Watched it all": follow the show (that's what loads its episode list) and tick every aired
 * episode. Returns how many were ticked; 0 means there was no episode list to tick.
 * `promptToRate: false` when the caller goes straight into rating anyway.
 */
export async function followAndWatchAll(tmdbId: number, { promptToRate = true } = {}) {
  await follow(tmdbId)
  const now = new Date()
  const aired = (await db.episodes.where('tmdb_show_id').equals(tmdbId).toArray()).filter((e) => isAired(e, now))
  await setWatched(aired, true, { promptToRate })
  return aired.length
}

type EpisodeRef = Pick<Episode, 'tmdb_show_id' | 'season' | 'number'>

/** Untick a show's episodes: all of them, or all except the ids in `keep`. */
export async function clearWatched(tmdbId: number, keep?: ReadonlySet<string>) {
  await db.watched
    .where('tmdb_show_id')
    .equals(tmdbId)
    .filter((w) => !keep?.has(w.id))
    .delete()
}

/**
 * Tick or untick episodes. Unnumbered specials can't be tracked and are skipped. Ticking the
 * episode that finishes a show offers to rate it (unless `promptToRate` is false).
 */
export async function setWatched(episodes: EpisodeRef[], value: boolean, { promptToRate = true } = {}) {
  const numbered = episodes.filter((e): e is EpisodeRef & { number: number } => e.number != null)
  const ids = numbered.map((e) => episodeKey(e.tmdb_show_id, e.season, e.number))
  if (!value) return db.watched.bulkDelete(ids)
  const now = new Date().toISOString()
  await db.watched.bulkPut(
    numbered.map((e, i) => ({ id: ids[i], tmdb_show_id: e.tmdb_show_id, season: e.season, number: e.number, watched_at: now })),
  )
  if (promptToRate) await offerRatingIfFinished(numbered.map((e) => e.tmdb_show_id))
}
