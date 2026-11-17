import type { Episode } from '../db'

const API = 'https://api.tvmaze.com'

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Give up on a request after this long, so one stuck connection can't hold up a refresh forever. */
const TIMEOUT_MS = 15_000

/**
 * TVmaze allows roughly 20 calls per 10 seconds. Calls are spaced out to stay under that even when
 * several shows refresh at once, and a 429 still backs off and retries.
 */
const GAP_MS = 550
let nextSlot = 0
async function waitForSlot() {
  const now = Date.now()
  const wait = Math.max(0, nextSlot - now)
  nextSlot = Math.max(now, nextSlot) + GAP_MS
  if (wait) await sleep(wait)
}

async function get<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await waitForSlot()
    let res: Response
    try {
      res = await fetch(API + path, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') throw new Error('TVmaze took too long to answer.')
      throw err
    }
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

const DAY = 24 * 60 * 60 * 1000

/** Names compared loosely: case, punctuation and "&" vs "and" don't matter. */
const sameName = (a: string, b: string) => {
  const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]/gu, '')
  return norm(a) === norm(b)
}

/**
 * Find the TVmaze show id from the IMDb id, then TheTVDB id. Some shows have neither on TMDB (e.g.
 * "Monsters: The Lyle and Erik Menendez Story", split off from the Monster anthology), so as a last
 * resort it searches by name, accepting only a show with the same name that premiered within a few
 * days of TMDB's date: names alone aren't unique (TVmaze has four shows called "The Office").
 */
export async function lookupTvmazeId(
  imdbId: string | null,
  tvdbId: number | null,
  byName?: { name: string; firstAired: string | null },
): Promise<number | null> {
  if (imdbId) {
    const show = await get<{ id: number }>(`/lookup/shows?imdb=${encodeURIComponent(imdbId)}`)
    if (show) return show.id
  }
  if (tvdbId) {
    const show = await get<{ id: number }>(`/lookup/shows?thetvdb=${tvdbId}`)
    if (show) return show.id
  }
  if (byName?.firstAired) {
    const wanted = Date.parse(byName.firstAired)
    const results = (await get<{ show: { id: number; name: string; premiered: string | null } }[]>(`/search/shows?q=${encodeURIComponent(byName.name)}`)) ?? []
    const match = results.find(
      ({ show }) => sameName(show.name, byName.name) && show.premiered && Math.abs(Date.parse(show.premiered) - wanted) <= 3 * DAY,
    )
    if (match) return match.show.id
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
    // TVmaze sometimes lists a season before dating it (often a streaming drop). Those come back
    // with airstamp '' for refreshShow to date from TMDB; any it can't date are left out.
    const t = e.airstamp ? Date.parse(e.airstamp) : NaN
    const dated = !Number.isNaN(t)
    out.push({
      id: e.id,
      tmdb_show_id: tmdbShowId,
      season: e.season,
      number: e.number,
      name: e.name,
      airstamp: dated ? new Date(t).toISOString() : '',
      has_time: dated && Boolean(e.airtime),
      runtime: e.runtime ?? null,
    })
  }
  return out
}
