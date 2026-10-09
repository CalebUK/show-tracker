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

/** A newly ranked show starts in the middle of its bucket (Liked 8.4, Fine 5.1, Didn't like 1.7). */
export const startingRating = (bucket: Bucket) => scoreToRating((RANGES[bucket][0] + RANGES[bucket][1]) / 2)

/** How many "Which was better?" questions one ranking asks (fewer if you haven't ranked that many shows). */
export const COMPARISONS = 6

/** How far one answer can move a rating. A new show moves a lot, the show it's compared with only a little. */
export const K_NEW = 64
export const K_REFINE = 32
export const K_OPPONENT = 16

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
