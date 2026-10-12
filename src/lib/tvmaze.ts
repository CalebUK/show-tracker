import type { Episode } from '../db'

const API = 'https://api.tvmaze.com'

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** TVmaze allows roughly 20 calls per 10 seconds; back off and retry on 429. */
async function get<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path)
    if (res.status === 404) return null
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1))
      continue
    }
    if (!res.ok) throw new Error(`TVmaze ${res.status}: ${res.statusText}`)
    return res.json() as Promise<T>
  }
  throw new Error('TVmaze is rate limiting requests. Try again in a minute.')
}

/** Find the TVmaze show id from the IMDb id (falling back to TheTVDB id). */
export async function lookupTvmazeId(imdbId: string | null, tvdbId: number | null): Promise<number | null> {
  if (imdbId) {
    const show = await get<{ id: number }>(`/lookup/shows?imdb=${encodeURIComponent(imdbId)}`)
    if (show) return show.id
  }
  if (tvdbId) {
    const show = await get<{ id: number }>(`/lookup/shows?thetvdb=${tvdbId}`)
    if (show) return show.id
  }
  return null
}

interface TvmazeEpisode {
  id: number
  season: number
  number: number | null
  name: string
  airtime: string
  airstamp: string | null
  runtime: number | null
}

/**
 * The full episode list (past and future), so past episodes can be ticked as watched.
 * null if TVmaze doesn't know the id (any more: shows sometimes get merged or re-added).
 */
export async function getEpisodes(tvmazeId: number, tmdbShowId: number): Promise<Episode[] | null> {
  const list = await get<TvmazeEpisode[]>(`/shows/${tvmazeId}/episodes`)
  if (!list) return null
  const out: Episode[] = []
  for (const e of list) {
    if (!e.airstamp) continue
    const t = Date.parse(e.airstamp)
    if (Number.isNaN(t)) continue
    out.push({
      id: e.id,
      tmdb_show_id: tmdbShowId,
      season: e.season,
      number: e.number,
      name: e.name,
      airstamp: new Date(t).toISOString(),
      has_time: Boolean(e.airtime),
      runtime: e.runtime ?? null,
    })
  }
  return out
}
