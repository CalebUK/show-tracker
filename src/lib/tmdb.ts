import type { Provider, Show } from '../db'

const API = 'https://api.themoviedb.org/3'
const IMAGE = 'https://image.tmdb.org/t/p'
const KEY = (import.meta.env.VITE_TMDB_KEY ?? '').trim()

export const hasTmdbKey = KEY.length > 0

export function posterUrl(path: string | null | undefined, size: 'w92' | 'w185' | 'w342' | 'w500' = 'w185') {
  return path ? `${IMAGE}/${size}${path}` : null
}

export function logoUrl(path: string | null | undefined) {
  return path ? `${IMAGE}/w92${path}` : null
}

/** Streaming availability is per country; use the device locale's region. */
export function region() {
  const match = /[-_]([A-Za-z]{2})\b/.exec(navigator.language)
  return match ? match[1].toUpperCase() : 'US'
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!hasTmdbKey) throw new Error('Missing TMDB key. Add VITE_TMDB_KEY to .env and restart.')
  const url = new URL(API + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const headers: Record<string, string> = { accept: 'application/json' }
  // A v4 read access token is a JWT; a v3 API key is a short hex string.
  if (KEY.startsWith('eyJ')) headers.authorization = `Bearer ${KEY}`
  else url.searchParams.set('api_key', KEY)

  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${res.statusText}`)
  return res.json() as Promise<T>
}

export interface SearchResult {
  id: number
  name: string
  poster_path: string | null
  first_air_date?: string
  overview: string
}

export async function searchShows(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  if (signal?.aborted) return []
  const data = await get<{ results: SearchResult[] }>('/search/tv', {
    query,
    include_adult: 'false',
    language: navigator.language || 'en-US',
  })
  return data.results
}

interface TmdbDetails {
  id: number
  name: string
  poster_path: string | null
  overview: string
  status: string
  first_air_date?: string
  networks?: { name: string }[]
  next_episode_to_air?: {
    air_date: string
    season_number: number
    episode_number: number
    name: string
  } | null
  external_ids?: { imdb_id: string | null; tvdb_id: number | null }
  'watch/providers'?: {
    results: Record<string, { link?: string; flatrate?: { provider_id: number; provider_name: string; logo_path: string | null }[] }>
  }
}

export interface ShowDetails {
  /** Fields that map straight onto a stored Show record. */
  show: Omit<Show, 'tvmaze_id' | 'followed' | 'followed_at' | 'last_refreshed_at'>
  tvdb_id: number | null
  /** TMDB's own idea of the next episode; used for shows that aren't followed (no TVmaze data yet). */
  next_episode: { air_date: string; season: number; number: number; name: string } | null
}

const detailsCache = new Map<number, Promise<ShowDetails>>()

export function getShowDetails(tmdbId: number, { fresh = false } = {}): Promise<ShowDetails> {
  if (!fresh && detailsCache.has(tmdbId)) return detailsCache.get(tmdbId)!
  const p = get<TmdbDetails>(`/tv/${tmdbId}`, {
    append_to_response: 'external_ids,watch/providers',
    language: navigator.language || 'en-US',
  }).then(toDetails)
  p.catch(() => detailsCache.delete(tmdbId))
  detailsCache.set(tmdbId, p)
  return p
}

function toDetails(d: TmdbDetails): ShowDetails {
  const providers = d['watch/providers']?.results?.[region()]?.flatrate ?? []
  const streaming: Provider[] = providers.map((p) => ({ id: p.provider_id, name: p.provider_name, logo_path: p.logo_path }))
  const next = d.next_episode_to_air
  return {
    show: {
      tmdb_id: d.id,
      imdb_id: d.external_ids?.imdb_id || null,
      name: d.name,
      poster_path: d.poster_path,
      overview: d.overview,
      status: d.status,
      network: d.networks?.[0]?.name ?? null,
      streaming,
      first_air_year: d.first_air_date ? d.first_air_date.slice(0, 4) : null,
    },
    tvdb_id: d.external_ids?.tvdb_id ?? null,
    next_episode: next?.air_date
      ? { air_date: next.air_date, season: next.season_number, number: next.episode_number, name: next.name }
      : null,
  }
}

/** Statuses that mean more episodes are expected. */
export function isOngoing(status: string) {
  return status === 'Returning Series' || status === 'In Production' || status === 'Planned' || status === 'Pilot'
}
