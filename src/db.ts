import Dexie, { type EntityTable } from 'dexie'
import { scoreToRating } from './lib/elo'

export interface Provider {
  id: number
  name: string
  logo_path: string | null
}

export interface Show {
  tmdb_id: number
  tvmaze_id: number | null
  imdb_id: string | null
  name: string
  poster_path: string | null
  overview: string
  /** TMDB status: "Returning Series", "Ended", "Canceled", "In Production", "Planned", "Pilot" */
  status: string
  network: string | null
  streaming: Provider[]
  first_air_year: string | null
  followed: boolean
  followed_at: string | null
  last_refreshed_at: string | null
  /** Ticked by the user on the show page. Optional so records saved before these existed still load. */
  own_dvd?: boolean
  own_streaming?: boolean
  /** "Stopped watching": still followed (stays in Shows and Rankings) but hidden from Watching. */
  stopped?: boolean
  /** From TMDB: the next announced episode (often a season premiere), if there is one. */
  next_air?: { date: string; season: number; number: number } | null
  in_production?: boolean
  /** Highest season TMDB lists; a new season can be listed before it has a date. */
  latest_season?: number | null
  /** Season of the most recently aired episode. */
  last_aired_season?: number | null
}

export const isOwned = (s: Show) => s.own_dvd === true || s.own_streaming === true

export interface Episode {
  /** TVmaze episode id */
  id: number
  tmdb_show_id: number
  season: number
  number: number | null
  name: string
  /** ISO timestamp in UTC */
  airstamp: string
  /** False when TVmaze only knows the date, not the time. */
  has_time: boolean
  /** Length in minutes: TMDB's where it has one, otherwise TVmaze's. Missing on episodes saved before this existed. */
  runtime?: number | null
  /** TMDB has been asked for this episode's runtime, so later refreshes don't ask again. */
  runtime_checked?: boolean
}

/**
 * An episode you've seen. Keyed by show/season/number rather than the TVmaze id, so ticks
 * survive refreshes and don't depend on where the episode list came from.
 */
export interface Watched {
  /** `${tmdb_show_id}:${season}:${number}` */
  id: string
  tmdb_show_id: number
  season: number
  number: number
  watched_at: string
}

export const episodeKey = (showId: number, season: number, number: number) => `${showId}:${season}:${number}`

/** Whether any episode of a show is ticked. Ticked shows keep their record and episode list after unfollowing. */
export const hasTicks = async (showId: number) => (await db.watched.where('tmdb_show_id').equals(showId).count()) > 0

export type Bucket = 'liked' | 'fine' | 'disliked'

export interface Ranking {
  tmdb_show_id: number
  bucket: Bucket
  /** Elo rating, moved by "Which was better?" answers. */
  rating: number
  /** How many comparisons this show has been part of. */
  comparisons: number
  /** 0.0–10.0, derived from the rating and kept inside the bucket's range. Never entered. */
  score: number
  ranked_at: string
}

/** Small key/value store for app state such as the last backup time. */
export interface Meta {
  key: string
  value: unknown
}

export const db = new Dexie('show-tracker') as Dexie & {
  shows: EntityTable<Show, 'tmdb_id'>
  episodes: EntityTable<Episode, 'id'>
  rankings: EntityTable<Ranking, 'tmdb_show_id'>
  watched: EntityTable<Watched, 'id'>
  meta: EntityTable<Meta, 'key'>
}

db.version(1).stores({
  shows: 'tmdb_id',
  episodes: 'id, tmdb_show_id, airstamp',
  rankings: 'tmdb_show_id, bucket',
  meta: 'key',
})

db.version(2)
  .stores({ watched: 'id, tmdb_show_id' })
  .upgrade((tx) =>
    // Version 1 only kept upcoming episodes. Mark followed shows stale so the next
    // refresh pulls their full episode list (needed for ticking past episodes).
    tx
      .table('shows')
      .toCollection()
      .modify((s: Show) => {
        if (s.followed) s.last_refreshed_at = null
      }),
  )

db.version(3)
  .stores({ rankings: 'tmdb_show_id, bucket' })
  .upgrade((tx) =>
    // Rankings switched from ordered positions to Elo ratings. Each show's existing
    // score converts straight to a rating, so nothing moves.
    tx
      .table('rankings')
      .toCollection()
      .modify((r: Ranking & { position?: number }) => {
        if (typeof r.rating !== 'number') r.rating = scoreToRating(r.score)
        if (typeof r.comparisons !== 'number') r.comparisons = 0
        delete r.position
      }),
  )

db.version(4)
  .stores({ shows: 'tmdb_id' })
  .upgrade((tx) =>
    // Episodes now carry their runtime (for "time watched"). Mark followed shows stale so the
    // next refresh re-downloads their episode lists with it.
    tx
      .table('shows')
      .toCollection()
      .modify((s: Show) => {
        if (s.followed) s.last_refreshed_at = null
      }),
  )

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}
