import { db, getMeta, isOwned, setMeta, type Bucket, type Ranking, type Show } from '../db'
import { DEFAULT_QUESTIONS, QUESTION_OPTIONS, ratingToScore, type QuestionSetting } from './elo'
import { createStore } from './store'

/** Questions per ranking (Settings → Ranking). Stored per phone; not part of backups. */
export const questionsStore = createStore<QuestionSetting>(DEFAULT_QUESTIONS)

export async function loadQuestionSetting() {
  const saved = await getMeta<QuestionSetting>('rankingQuestions')
  if (saved && QUESTION_OPTIONS.includes(saved)) questionsStore.set(saved)
}

export async function setQuestionSetting(value: QuestionSetting) {
  await setMeta('rankingQuestions', value)
  questionsStore.set(value)
}

export const BUCKETS: { id: Bucket; label: string; short: string }[] = [
  { id: 'liked', label: 'Liked it', short: 'Liked' },
  { id: 'fine', label: 'It was fine', short: 'Fine' },
  { id: 'disliked', label: "Didn't like it", short: "Didn't like" },
]

/** Highest score first; ties (e.g. two shows at 10.0) go to the higher rating. */
export function sortRankings(a: Ranking, b: Ranking) {
  return b.score - a.score || b.rating - a.rating
}

export interface Opponent {
  id: number
  name: string
  poster_path: string | null
  bucket: Bucket
  rating: number
}

/** Every ranked show except one, as candidates to compare against. */
export async function rankedPool(excludeId: number): Promise<Opponent[]> {
  const rankings = (await db.rankings.toArray()).filter((r) => r.tmdb_show_id !== excludeId)
  const shows = await db.shows.bulkGet(rankings.map((r) => r.tmdb_show_id))
  return rankings.map((r, i) => ({
    id: r.tmdb_show_id,
    name: shows[i]?.name ?? 'Unknown show',
    poster_path: shows[i]?.poster_path ?? null,
    bucket: r.bucket,
    rating: r.rating,
  }))
}

export interface RankingResult {
  bucket: Bucket
  rating: number
  /** Total comparisons this show has been through, including earlier rankings. */
  comparisons: number
  /** New ratings for the shows it was compared with. */
  opponents: Map<number, number>
}

/**
 * Save a finished ranking: the show's new rating and score, plus the adjusted ratings of
 * the shows it was compared with. Saves the show record too if it isn't stored yet
 * (a show can be ranked without being followed).
 */
export async function saveRanking(show: Show, result: RankingResult) {
  await db.transaction('rw', db.shows, db.rankings, async () => {
    if (!(await db.shows.get(show.tmdb_id))) await db.shows.put(show)
    await db.rankings.put({
      tmdb_show_id: show.tmdb_id,
      bucket: result.bucket,
      rating: result.rating,
      comparisons: result.comparisons,
      score: ratingToScore(result.bucket, result.rating),
      ranked_at: new Date().toISOString(),
    })
    for (const [id, rating] of result.opponents) {
      const r = await db.rankings.get(id)
      if (r) await db.rankings.put({ ...r, rating, comparisons: r.comparisons + 1, score: ratingToScore(r.bucket, rating) })
    }
  })
}

/** Remove a show from the rankings. Other shows keep their ratings. */
export async function removeRanking(tmdbId: number) {
  await db.transaction('rw', db.shows, db.rankings, async () => {
    await db.rankings.delete(tmdbId)
    // Clean up shows that are no longer followed, ranked or owned.
    const show = await db.shows.get(tmdbId)
    if (show && !show.followed && !isOwned(show)) await db.shows.delete(tmdbId)
  })
}
