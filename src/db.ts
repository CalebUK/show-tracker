import Dexie, { type EntityTable } from 'dexie'

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
}

export type Bucket = 'liked' | 'fine' | 'disliked'

export interface Ranking {
  tmdb_show_id: number
  bucket: Bucket
  /** Order within the bucket; 0 = best. */
  position: number
  /** 0.0–10.0, derived from bucket + position, never entered. */
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
  meta: EntityTable<Meta, 'key'>
}

db.version(1).stores({
  shows: 'tmdb_id',
  episodes: 'id, tmdb_show_id, airstamp',
  rankings: 'tmdb_show_id, bucket',
  meta: 'key',
})

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}
