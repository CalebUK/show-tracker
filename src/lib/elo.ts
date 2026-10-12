import type { Bucket } from '../db'

/** The score range each bucket covers. Scores never leave their bucket's range. */
export const RANGES: Record<Bucket, [top: number, bottom: number]> = {
  liked: [10.0, 6.8],
  fine: [6.7, 3.4],
  disliked: [3.3, 0.0],
}

/** Ratings and scores are tied together: 1500 is a 5.0, and every 100 points is one point of score. */
export const scoreToRating = (score: number) => 1500 + (score - 5) * 100

export function ratingToScore(bucket: Bucket, rating: number) {
  const [top, bottom] = RANGES[bucket]
  const score = Math.min(top, Math.max(bottom, 5 + (rating - 1500) / 100))
  return Math.round(score * 10) / 10
}

/** The score a rating would have with no bucket limits, rounded like displayed scores. */
export const rawScore = (rating: number) => Math.round((5 + (rating - 1500) / 100) * 10) / 10

/** Which bucket's range a score falls in (above 10 counts as Liked, below 0 as Didn't like). */
export function bucketForScore(score: number): Bucket {
  if (score >= RANGES.liked[1]) return 'liked'
  if (score >= RANGES.fine[1]) return 'fine'
  return 'disliked'
}

/** If your answers pushed a show's rating past its bucket's range, the bucket it now belongs in. */
export function suggestedBucket(bucket: Bucket, rating: number): Bucket | null {
  const fits = bucketForScore(rawScore(rating))
  return fits === bucket ? null : fits
}

/** A newly ranked show starts in the middle of its bucket (Liked 8.4, Fine 5.1, Didn't like 1.7). */
export const startingRating = (bucket: Bucket) => scoreToRating((RANGES[bucket][0] + RANGES[bucket][1]) / 2)

/** Questions per ranking, chosen in Settings. 'all' compares against every ranked show. */
export type QuestionSetting = 6 | 10 | 15 | 'all'
export const QUESTION_OPTIONS: QuestionSetting[] = [6, 10, 15, 'all']
export const DEFAULT_QUESTIONS: QuestionSetting = 6

/** How many questions a ranking will ask: the setting, capped at how many other shows are ranked. */
export const questionCount = (setting: QuestionSetting, poolSize: number) =>
  setting === 'all' ? poolSize : Math.min(setting, poolSize)

/** How far one answer can move a rating. A new show moves a lot, the show it's compared with only a little. */
export const K_NEW = 64
export const K_REFINE = 32
export const K_OPPONENT = 16

/**
 * A new show's first 6 answers move it in big steps to find roughly where it belongs; after that
 * (and when fine-tuning with "Compare more") the steps are smaller, so long sessions settle down.
 */
export const kFor = (questionIndex: number, refining: boolean) => (refining || questionIndex >= 6 ? K_REFINE : K_NEW)

/** "Keep comparing": two already-ranked shows, so both move by the same, moderate amount. */
export const K_KEEP = 24

/**
 * Two different shows picked completely at random, avoiding an exact repeat of the previous
 * pair when there are more than two to choose from. null with fewer than two.
 */
export function randomPair<T>(items: T[], previous?: readonly [T, T] | null, random = Math.random): [T, T] | null {
  if (items.length < 2) return null
  const same = (a: T, b: T) => !!previous && ((a === previous[0] && b === previous[1]) || (a === previous[1] && b === previous[0]))
  for (let attempt = 0; attempt < 10; attempt++) {
    const i = Math.floor(random() * items.length)
    let j = Math.floor(random() * (items.length - 1))
    if (j >= i) j++
    if (items.length === 2 || !same(items[i], items[j])) return [items[i], items[j]]
  }
  return [items[0], items[1]]
}

/** Chance that a show rated `a` is preferred over one rated `b`. */
export const expectedScore = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400))

/** `result` is 1 if A was better, 0 if B was, 0.5 for too close to call. Returns the new ratings. */
export function eloUpdate(a: number, b: number, result: number, kA: number, kB: number): [number, number] {
  const expectedA = expectedScore(a, b)
  return [a + kA * (result - expectedA), b + kB * (expectedA - result)]
}

/** The most useful next comparison: the closest-rated show not yet asked about, same bucket preferred. */
export function pickOpponent<T extends { id: number; rating: number; bucket: Bucket }>(
  rating: number,
  bucket: Bucket,
  pool: T[],
  used: ReadonlySet<number>,
): T | null {
  let best: T | null = null
  let bestDistance = Infinity
  for (const o of pool) {
    if (used.has(o.id)) continue
    const distance = Math.abs(o.rating - rating) + (o.bucket === bucket ? 0 : 50)
    if (distance < bestDistance) {
      best = o
      bestDistance = distance
    }
  }
  return best
}
