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

/** The same key for a pair whichever way round it is. */
export const pairKey = <T>(a: T, b: T) => [String(a), String(b)].sort().join('|')

/**
 * Two different shows picked completely at random from the pairs whose `pairKey` isn't in
 * `used`. null once every pair has been used, or with fewer than two.
 */
export function randomPair<T>(items: T[], used: ReadonlySet<string> = new Set(), random = Math.random): [T, T] | null {
  const n = items.length
  if (n < 2) return null
  // Random tries first: plenty of pairs are left for most of a session.
  for (let attempt = 0; attempt < 20; attempt++) {
    const i = Math.floor(random() * n)
    let j = Math.floor(random() * (n - 1))
    if (j >= i) j++
    if (!used.has(pairKey(items[i], items[j]))) return [items[i], items[j]]
  }
  // Near the end, pick from whatever's left.
  const left: [T, T][] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (!used.has(pairKey(items[i], items[j]))) left.push([items[i], items[j]])
  }
  if (!left.length) return null
  const [a, b] = left[Math.floor(random() * left.length)]
  return random() < 0.5 ? [a, b] : [b, a]
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
