import { db, getMeta, setMeta, type Provider, type Show } from '../db'
import { createStore } from './store'

const API = 'https://api.themoviedb.org/3'
const IMAGE = 'https://image.tmdb.org/t/p'

/**
 * Each phone stores its own TMDB key, so the deployed site never contains one.
 * In development only, .env can supply a key; production builds compile this to ''.
 */
export const DEV_KEY = import.meta.env.DEV ? (import.meta.env.VITE_TMDB_KEY ?? '').trim() : ''

export const tmdbKeyStore = createStore<string>('')
export const getTmdbKey = () => tmdbKeyStore.get() || DEV_KEY
export const useTmdbKey = () => tmdbKeyStore.use() || DEV_KEY

export async function loadTmdbKey() {
  tmdbKeyStore.set((await getMeta<string>('tmdbKey')) ?? '')
}

/** Check the key with TMDB, then store it on this device. Throws a readable error if it doesn't work. */
export async function saveTmdbKey(input: string) {
  const key = input.trim()
  if (!key) throw new Error('Paste your key first.')
  let res: Response
  try {
    res = await fetch(...request('/authentication', {}, key))
  } catch {
    throw new Error("Couldn't reach TMDB to check the key. Are you online?")
  }
  if (res.status === 401) throw new Error("TMDB didn't accept that key. Check that you copied all of it.")
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${res.statusText}`)
  await setMeta('tmdbKey', key)
  tmdbKeyStore.set(key)
  detailsCache.clear()
}

export async function removeTmdbKey() {
  await db.meta.delete('tmdbKey')
  tmdbKeyStore.set('')
  detailsCache.clear()
}

export function posterUrl(path: string | null | undefined, size: 'w92' | 'w185' | 'w342' | 'w500' = 'w185') {
  return path ? `${IMAGE}/${size}${path}` : null
}

export function logoUrl(path: string | null | undefined) {
  return path ? `${IMAGE}/w92${path}` : null
}

/** Best guess from the phone's language setting (en-GB → GB). Not always right, so it can be overridden. */
export function detectedRegion() {
  for (const lang of navigator.languages ?? [navigator.language]) {
    const match = /[-_]([A-Za-z]{2})\b/.exec(lang)
    if (match) return match[1].toUpperCase()
  }
  return 'US'
}

/** Streaming availability is per country. '' means use the detected region. */
export const regionStore = createStore<string>('')
export const region = () => regionStore.get() || detectedRegion()
export const useRegion = () => regionStore.use() || detectedRegion()

export async function loadRegion() {
  regionStore.set((await getMeta<string>('region')) ?? '')
}

export async function setRegion(code: string) {
  await setMeta('region', code)
  regionStore.set(code)
  detailsCache.clear()
}

const regionNames = new Intl.DisplayNames(undefined, { type: 'region' })
export const regionName = (code: string) => regionNames.of(code) ?? code

/** Countries TMDB has streaming data for. */
export async function getStreamingRegions(): Promise<{ code: string; name: string }[]> {
  const data = await get<{ results: { iso_3166_1: string }[] }>('/watch/providers/regions')
  return data.results
    .map((r) => ({ code: r.iso_3166_1, name: regionName(r.iso_3166_1) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function request(path: string, params: Record<string, string>, key: string): [URL, RequestInit] {
  const url = new URL(API + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const headers: Record<string, string> = { accept: 'application/json' }
  // A v4 read access token is a JWT; a v3 API key is a short hex string.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`
  else url.searchParams.set('api_key', key)
  return [url, { headers }]
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = getTmdbKey()
  if (!key) throw new Error('Add your TMDB key in Settings first.')
  const res = await fetch(...request(path, params, key))
  if (res.status === 401) throw new Error("Your TMDB key isn't working. Check it in Settings.")
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
  last_episode_to_air?: { season_number: number } | null
  in_production?: boolean
  seasons?: { season_number: number }[]
  external_ids?: { imdb_id: string | null; tvdb_id: number | null }
  'watch/providers'?: {
    results: Record<string, Partial<Record<'flatrate' | 'free' | 'ads', TmdbProvider[]>>>
  }
}

interface TmdbProvider {
  provider_id: number
  provider_name: string
  logo_path: string | null
  display_priority?: number
}

export interface ShowDetails {
  /** Fields that map straight onto a stored Show record. */
  show: Omit<Show, 'tvmaze_id' | 'followed' | 'followed_at' | 'last_refreshed_at' | 'own_dvd' | 'own_streaming'>
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

/** Subscription services first, then free and ad-supported ones (BBC iPlayer, ITVX, Tubi…). No rent/buy. */
function streamingFor(d: TmdbDetails): Provider[] {
  const offers = d['watch/providers']?.results?.[region()]
  if (!offers) return []
  const seen = new Set<number>()
  const out: Provider[] = []
  for (const kind of ['flatrate', 'free', 'ads'] as const) {
    const list = [...(offers[kind] ?? [])].sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))
    for (const p of list) {
      if (seen.has(p.provider_id)) continue
      seen.add(p.provider_id)
      out.push({ id: p.provider_id, name: p.provider_name, logo_path: p.logo_path })
    }
  }
  // Drop variants like "Netflix Standard with Ads" or "AcornTV Amazon Channel" when the main service is listed.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return out.filter((p, i) =>
    !out.some((q, j) => {
      if (j === i) return false
      const [a, b] = [norm(p.name), norm(q.name)]
      return a === b ? j < i : a.startsWith(b)
    }),
  )
}

function toDetails(d: TmdbDetails): ShowDetails {
  const streaming = streamingFor(d)
  const next = d.next_episode_to_air
  const seasons = (d.seasons ?? []).map((s) => s.season_number).filter((n) => n > 0)
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
      next_air: next?.air_date ? { date: next.air_date, season: next.season_number, number: next.episode_number } : null,
      in_production: d.in_production === true,
      latest_season: seasons.length ? Math.max(...seasons) : null,
      last_aired_season: d.last_episode_to_air?.season_number ?? null,
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
