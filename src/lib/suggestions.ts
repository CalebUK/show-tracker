import { db, getMeta, isKeptOutOfRating, setMeta, type Provider, type Ranking, type Show } from '../db'
import { createStore } from './store'
import { getRecommendations, getShowDetails, region, type Recommendation } from './tmdb'

/**
 * "Suggestions" (Search tab): shows you might like, from TMDB's "people who liked this also
 * liked" lists for the shows you rated well, pushed down if they come up alongside ones you didn't
 * like, and weighted by TMDB's global rating.
 */

/** Suggestions need at least this many shows rated 6 or higher. */
export const MIN_LIKED = 3
const LIKED_FROM = 6
const DISLIKED_TO = 3.3
const MAX_LIKED = 12
const MAX_DISLIKED = 6
const MAX_RESULTS = 30
/** Too few votes for the global rating to mean much. */
const MIN_VOTES = 25

const DAY = 24 * 60 * 60 * 1000
/** TMDB's recommendation lists barely change, so each is kept a week. */
const RECS_TTL = 7 * DAY
/** Where to stream changes more often. */
const STREAMING_TTL = DAY

export interface Seed {
  id: number
  name: string
  /** 0–1: how strongly this show pulls. */
  weight: number
}

export interface Suggestion extends Recommendation {
  score: number
  /** Your shows that led to it, strongest first. */
  because: string[]
}

/**
 * The shows suggestions are built from. Liked: rated 6 or higher, best first, a 10 pulling twice as
 * hard as a 7.5. Disliked: rated 3.3 or lower. Shows kept out of rating (tagged for someone else,
 * or excluded) aren't your taste, so they're left out.
 */
export function pickSeeds(rankings: Ranking[], shows: Map<number, Show>): { liked: Seed[]; disliked: Seed[] } {
  const usable = rankings.flatMap((r) => {
    const show = shows.get(r.tmdb_show_id)
    return show && !isKeptOutOfRating(show) ? [{ id: r.tmdb_show_id, name: show.name, score: r.score }] : []
  })
  return {
    liked: usable
      .filter((r) => r.score >= LIKED_FROM)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_LIKED)
      .map((r) => ({ id: r.id, name: r.name, weight: (r.score - 5) / 5 })),
    disliked: usable
      .filter((r) => r.score <= DISLIKED_TO)
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_DISLIKED)
      .map((r) => ({ id: r.id, name: r.name, weight: (5 - r.score) / 5 })),
  }
}

/**
 * Each show recommended by one you liked gains that show's weight, a little less the further down
 * its list. One recommended by several of your favourites rises to the top. Coming up alongside
 * one you didn't like costs points. The total is then weighted by TMDB's global rating.
 * Little-known shows and anything in `exclude` are left out.
 */
export function rankSuggestions(
  liked: Seed[],
  disliked: Seed[],
  recs: Map<number, Recommendation[]>,
  exclude: ReadonlySet<number>,
): Suggestion[] {
  const tally = new Map<number, { rec: Recommendation; score: number; penalty: number; because: Map<string, number> }>()
  const entry = (rec: Recommendation) => {
    let e = tally.get(rec.id)
    if (!e) tally.set(rec.id, (e = { rec, score: 0, penalty: 0, because: new Map() }))
    return e
  }
  // First on a list counts fully, last about half.
  const near = (i: number, n: number) => 1 - (0.5 * i) / Math.max(n, 1)

  for (const seed of liked) {
    const list = recs.get(seed.id) ?? []
    list.forEach((rec, i) => {
      const e = entry(rec)
      const points = seed.weight * near(i, list.length)
      e.score += points
      e.because.set(seed.name, (e.because.get(seed.name) ?? 0) + points)
    })
  }
  for (const seed of disliked) {
    const list = recs.get(seed.id) ?? []
    list.forEach((rec, i) => (entry(rec).penalty += seed.weight * near(i, list.length)))
  }

  const out: Suggestion[] = []
  for (const { rec, score, penalty, because } of tally.values()) {
    if (exclude.has(rec.id) || score <= 0 || rec.vote_count < MIN_VOTES) continue
    const total = (score - 0.75 * penalty) * (0.4 + (0.6 * rec.vote_average) / 10)
    if (total <= 0) continue
    out.push({ ...rec, score: total, because: [...because].sort((a, b) => b[1] - a[1]).map(([name]) => name) })
  }
  return out.sort((a, b) => b.score - a.score || b.vote_average - a.vote_average).slice(0, MAX_RESULTS)
}

/** "Because you liked Ludwig", "… Ludwig and Ted Lasso", "… Ludwig, Ted Lasso and 2 more". */
export function becauseLine(names: string[]) {
  if (names.length <= 2) return `Because you liked ${names.join(' and ')}`
  return `Because you liked ${names[0]}, ${names[1]} and ${names.length - 2} more`
}

export type SuggestionsResult =
  | { kind: 'need-more'; liked: number }
  | { kind: 'ready'; items: Suggestion[]; /** Some lists couldn't be fetched (offline?). */ incomplete: boolean }

type RecsCache = Record<string, { at: number; items: Recommendation[] }>
type StreamingCache = Record<string, { at: number; region: string; providers: Provider[] }>

/** Run `work` over `items`, a few at a time, to stay polite to TMDB. */
async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(work))
}

/** Work out suggestions from your current rankings, fetching only the lists not cached yet. */
export async function buildSuggestions(): Promise<SuggestionsResult> {
  const [rankings, shows] = await Promise.all([db.rankings.toArray(), db.shows.toArray()])
  const byId = new Map(shows.map((s) => [s.tmdb_id, s]))
  const { liked, disliked } = pickSeeds(rankings, byId)
  if (liked.length < MIN_LIKED) return { kind: 'need-more', liked: liked.length }

  const now = Date.now()
  const cache = (await getMeta<RecsCache>('suggestionRecs')) ?? {}
  const seeds = [...liked, ...disliked]
  const stale = seeds.filter((s) => !cache[s.id] || now - cache[s.id].at > RECS_TTL)
  let incomplete = false
  if (stale.length) {
    await inBatches(stale, 4, async (s) => {
      try {
        cache[s.id] = { at: now, items: await getRecommendations(s.id) }
      } catch {
        incomplete = true
      }
    })
    for (const id of Object.keys(cache)) if (now - cache[id].at > 2 * RECS_TTL) delete cache[id]
    await setMeta('suggestionRecs', cache)
  }

  const recs = new Map(seeds.map((s) => [s.id, cache[s.id]?.items ?? []]))
  // Anything already in the app (followed, ranked, owned, ticked) and anything you've hidden.
  const exclude = new Set([...byId.keys(), ...hiddenSuggestionsStore.get()])
  return { kind: 'ready', items: rankSuggestions(liked, disliked, recs, exclude), incomplete }
}

/** Where each suggestion streams in your region, for the service pills and the On my services filter. */
export async function suggestionStreaming(ids: number[]): Promise<Map<number, Provider[]>> {
  const code = region()
  const now = Date.now()
  const cache = (await getMeta<StreamingCache>('suggestionStreaming')) ?? {}
  const missing = ids.filter((id) => !cache[id] || cache[id].region !== code || now - cache[id].at > STREAMING_TTL)
  if (missing.length) {
    await inBatches(missing, 4, async (id) => {
      try {
        cache[id] = { at: now, region: code, providers: (await getShowDetails(id)).show.streaming }
      } catch {
        // Leave it without a pill for now.
      }
    })
    for (const id of Object.keys(cache)) if (now - cache[id].at > 3 * STREAMING_TTL) delete cache[id]
    await setMeta('suggestionStreaming', cache)
  }
  return new Map(ids.flatMap((id): [number, Provider[]][] => (cache[id] ? [[id, cache[id].providers]] : [])))
}

/** Suggestions you've said you're not interested in. Included in backups. */
export const hiddenSuggestionsStore = createStore<number[]>([])

export async function loadHiddenSuggestions() {
  const saved = await getMeta<number[]>('hiddenSuggestions')
  if (Array.isArray(saved)) hiddenSuggestionsStore.set(saved)
}

export async function setHiddenSuggestions(ids: number[]) {
  await setMeta('hiddenSuggestions', ids)
  hiddenSuggestionsStore.set(ids)
}

export const hideSuggestion = (id: number) => setHiddenSuggestions([...new Set([...hiddenSuggestionsStore.get(), id])])
