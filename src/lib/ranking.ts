import { db, isOwned, type Bucket, type Ranking, type Show } from '../db'

export const BUCKETS: { id: Bucket; label: string; short: string }[] = [
  { id: 'liked', label: 'Liked it', short: 'Liked' },
  { id: 'fine', label: 'It was fine', short: 'Fine' },
  { id: 'disliked', label: "Didn't like it", short: "Didn't like" },
]

const RANGES: Record<Bucket, [top: number, bottom: number]> = {
  liked: [10.0, 6.8],
  fine: [6.7, 3.4],
  disliked: [3.3, 0.0],
}

const BUCKET_ORDER: Record<Bucket, number> = { liked: 0, fine: 1, disliked: 2 }

/** Spread shows evenly from the top to the bottom of the bucket's range. */
export function scoreFor(bucket: Bucket, position: number, count: number) {
  const [top, bottom] = RANGES[bucket]
  if (count <= 1) return top
  const score = top - (position / (count - 1)) * (top - bottom)
  return Math.round(score * 10) / 10
}

/**
 * One step of binary insertion. `range` is [low, high); the caller compares the new
 * show against bucket[mid] and passes the answer back in.
 */
export interface SearchRange {
  low: number
  high: number
}

export const midpoint = ({ low, high }: SearchRange) => Math.floor((low + high) / 2)

export function narrow(range: SearchRange, newIsBetter: boolean): SearchRange {
  const mid = midpoint(range)
  return newIsBetter ? { low: range.low, high: mid } : { low: mid + 1, high: range.high }
}

export const isPlaced = ({ low, high }: SearchRange) => low >= high

/** Roughly how many more comparisons are left. */
export const comparisonsLeft = ({ low, high }: SearchRange) => (high > low ? Math.ceil(Math.log2(high - low + 1)) : 0)

export function sortRankings(a: Ranking, b: Ranking) {
  return b.score - a.score || BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || a.position - b.position
}

/** Shows in a bucket, best first, optionally leaving one out (used when re-ranking). */
export async function bucketShows(bucket: Bucket, excludeId?: number): Promise<{ ranking: Ranking; show: Show | undefined }[]> {
  const rankings = (await db.rankings.where('bucket').equals(bucket).sortBy('position')).filter(
    (r) => r.tmdb_show_id !== excludeId,
  )
  const shows = await db.shows.bulkGet(rankings.map((r) => r.tmdb_show_id))
  return rankings.map((ranking, i) => ({ ranking, show: shows[i] }))
}

/** Rewrite positions and scores for an ordered list of show ids in one bucket. */
async function writeBucket(bucket: Bucket, ids: number[], rankedAt: Map<number, string>) {
  const now = new Date().toISOString()
  await db.rankings.bulkPut(
    ids.map((id, position) => ({
      tmdb_show_id: id,
      bucket,
      position,
      score: scoreFor(bucket, position, ids.length),
      ranked_at: rankedAt.get(id) ?? now,
    })),
  )
}

async function orderedIds(bucket: Bucket, excludeId?: number) {
  const list = await db.rankings.where('bucket').equals(bucket).sortBy('position')
  return {
    ids: list.map((r) => r.tmdb_show_id).filter((id) => id !== excludeId),
    rankedAt: new Map(list.map((r) => [r.tmdb_show_id, r.ranked_at])),
  }
}

/**
 * Place a show at `index` within `bucket`. Saves the show record if it isn't stored yet
 * (a show can be ranked without being followed). If the show was already ranked, it is
 * moved, and both affected buckets are rescored.
 */
export async function placeShow(show: Show, bucket: Bucket, index: number) {
  await db.transaction('rw', db.shows, db.rankings, async () => {
    if (!(await db.shows.get(show.tmdb_id))) await db.shows.put(show)

    const previous = await db.rankings.get(show.tmdb_id)
    if (previous) {
      await db.rankings.delete(show.tmdb_id)
      if (previous.bucket !== bucket) {
        const old = await orderedIds(previous.bucket)
        await writeBucket(previous.bucket, old.ids, old.rankedAt)
      }
    }

    const { ids, rankedAt } = await orderedIds(bucket, show.tmdb_id)
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, show.tmdb_id)
    rankedAt.delete(show.tmdb_id)
    await writeBucket(bucket, ids, rankedAt)
  })
}

/** Remove a show from the rankings and rescore its bucket. */
export async function removeRanking(tmdbId: number) {
  await db.transaction('rw', db.shows, db.rankings, async () => {
    const previous = await db.rankings.get(tmdbId)
    if (!previous) return
    await db.rankings.delete(tmdbId)
    const { ids, rankedAt } = await orderedIds(previous.bucket)
    await writeBucket(previous.bucket, ids, rankedAt)
    // Clean up shows that are no longer followed, ranked or owned.
    const show = await db.shows.get(tmdbId)
    if (show && !show.followed && !isOwned(show)) await db.shows.delete(tmdbId)
  })
}
