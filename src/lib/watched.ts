import { db, episodeKey, type Episode } from '../db'

type EpisodeRef = Pick<Episode, 'tmdb_show_id' | 'season' | 'number'>

/** Untick a show's episodes: all of them, or all except the ids in `keep`. */
export async function clearWatched(tmdbId: number, keep?: ReadonlySet<string>) {
  await db.watched
    .where('tmdb_show_id')
    .equals(tmdbId)
    .filter((w) => !keep?.has(w.id))
    .delete()
}

/** Tick or untick episodes. Unnumbered specials can't be tracked and are skipped. */
export async function setWatched(episodes: EpisodeRef[], value: boolean) {
  const numbered = episodes.filter((e): e is EpisodeRef & { number: number } => e.number != null)
  const ids = numbered.map((e) => episodeKey(e.tmdb_show_id, e.season, e.number))
  if (!value) return db.watched.bulkDelete(ids)
  const now = new Date().toISOString()
  await db.watched.bulkPut(
    numbered.map((e, i) => ({ id: ids[i], tmdb_show_id: e.tmdb_show_id, season: e.season, number: e.number, watched_at: now })),
  )
}
