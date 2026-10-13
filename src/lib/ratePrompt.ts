import { db } from '../db'
import { isFinished, progressFor } from './progress'
import { createStore } from './store'

/** The show to offer "You finished it, rate it?" for, or null. */
export const ratePromptStore = createStore<number | null>(null)

/**
 * After ticking episodes: if that finished a show (ended, every episode ticked) that isn't
 * ranked yet, offer to rate it. Only runs at the moment of ticking, so it never nags.
 */
export async function offerRatingIfFinished(showIds: number[]) {
  for (const id of new Set(showIds)) {
    if (await db.rankings.get(id)) continue
    const show = await db.shows.get(id)
    if (!show || show.exclude_from_rating) continue
    const [episodes, watched] = await Promise.all([
      db.episodes.where('tmdb_show_id').equals(id).toArray(),
      db.watched.where('tmdb_show_id').equals(id).toArray(),
    ])
    if (isFinished(show, progressFor(episodes, watched))) {
      ratePromptStore.set(id)
      return
    }
  }
}
