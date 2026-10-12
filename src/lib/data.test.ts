// Tests for the code that reads and writes saved data, run against an in-memory IndexedDB.
// This import must come first so Dexie sees the fake database.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, episodeKey, type Bucket, type Episode, type Ranking, type Show } from '../db'
import { buildBackup, parseBackup, restoreBackup } from './backup'
import { ratingToScore } from './elo'
import { ratePromptStore } from './ratePrompt'
import { removeRanking, restoreRankings, saveComparison, saveRanking } from './ranking'
import { refreshShow, setOwned, unfollow } from './shows'
import { getEpisodeRuntimes, getShowDetails, type ShowDetails } from './tmdb'
import { getEpisodes, lookupTvmazeId } from './tvmaze'
import { setWatched } from './watched'

// TMDB and TVmaze are replaced with canned answers; nothing here touches the network.
vi.mock('./tmdb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tmdb')>()),
  getShowDetails: vi.fn(),
  getEpisodeRuntimes: vi.fn(),
}))
vi.mock('./tvmaze', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tvmaze')>()),
  getEpisodes: vi.fn(),
  lookupTvmazeId: vi.fn(),
}))

const DAY = 86_400_000

const show = (id: number, extra: Partial<Show> = {}): Show => ({
  tmdb_id: id,
  tvmaze_id: 100 + id,
  imdb_id: null,
  name: `Show ${id}`,
  poster_path: null,
  overview: '',
  status: 'Ended',
  network: null,
  streaming: [],
  first_air_year: null,
  followed: true,
  followed_at: '2026-01-01T00:00:00.000Z',
  last_refreshed_at: '2026-01-01T00:00:00.000Z',
  ...extra,
})

/** An episode that aired `daysAgo` days ago (negative = in the future). */
const ep = (showId: number, season: number, number: number, daysAgo = 30, extra: Partial<Episode> = {}): Episode => ({
  id: showId * 1000 + season * 100 + number,
  tmdb_show_id: showId,
  season,
  number,
  name: `S${season}E${number}`,
  airstamp: new Date(Date.now() - daysAgo * DAY).toISOString(),
  has_time: true,
  ...extra,
})

const ranking = (id: number, bucket: Bucket, rating: number): Ranking => ({
  tmdb_show_id: id,
  bucket,
  rating,
  comparisons: 0,
  score: ratingToScore(bucket, rating),
  ranked_at: '2026-01-01T00:00:00.000Z',
})

const details = (id: number, extra: Partial<ShowDetails['show']> = {}): ShowDetails => ({
  show: {
    tmdb_id: id,
    imdb_id: null,
    name: `Show ${id}`,
    poster_path: null,
    overview: '',
    status: 'Returning Series',
    network: null,
    streaming: [{ id: 8, name: 'Netflix', logo_path: null }],
    first_air_year: null,
    next_air: null,
    in_production: false,
    latest_season: 2,
    last_aired_season: 1,
    ...extra,
  },
  tvdb_id: null,
  next_episode: null,
})

const episodeCount = (id: number) => db.episodes.where('tmdb_show_id').equals(id).count()

beforeEach(async () => {
  // A fresh, empty database for every test.
  await db.delete()
  await db.open()
  ratePromptStore.set(null)
  vi.clearAllMocks()
})

describe('unfollowing', () => {
  it('keeps a show you have ticked, with its episodes, so its history and time stay', async () => {
    await db.shows.put(show(1))
    await db.episodes.bulkPut([ep(1, 1, 1), ep(1, 1, 2)])
    await setWatched([ep(1, 1, 1)], true)

    await unfollow(1)

    expect(await db.shows.get(1)).toMatchObject({ followed: false, followed_at: null })
    expect(await episodeCount(1)).toBe(2)
    expect(await db.watched.count()).toBe(1)
  })

  it('removes a show you never ticked, ranked or owned, and its episodes', async () => {
    await db.shows.put(show(2))
    await db.episodes.bulkPut([ep(2, 1, 1)])

    await unfollow(2)

    expect(await db.shows.get(2)).toBeUndefined()
    expect(await episodeCount(2)).toBe(0)
  })

  it('keeps a ranked show but drops its episodes when nothing was ticked', async () => {
    await db.shows.put(show(3))
    await db.episodes.bulkPut([ep(3, 1, 1)])
    await db.rankings.put(ranking(3, 'liked', 1840))

    await unfollow(3)

    expect(await db.shows.get(3)).toMatchObject({ followed: false })
    expect(await episodeCount(3)).toBe(0)
  })

  it('keeps an owned show', async () => {
    await db.shows.put(show(4, { own_dvd: true }))
    await unfollow(4)
    expect(await db.shows.get(4)).toMatchObject({ followed: false, own_dvd: true })
  })
})

describe('owning and un-ranking', () => {
  it('drops an unfollowed show once it is no longer owned, ranked or ticked', async () => {
    await db.shows.put(show(5, { followed: false, own_dvd: true }))
    await setOwned(5, 'own_dvd', false)
    expect(await db.shows.get(5)).toBeUndefined()
  })

  it('keeps an unfollowed show you have ticked when its ranking is removed', async () => {
    await db.shows.put(show(6, { followed: false }))
    await db.episodes.bulkPut([ep(6, 1, 1)])
    await db.rankings.put(ranking(6, 'fine', 1500))
    await setWatched([ep(6, 1, 1)], true, { promptToRate: false })

    await removeRanking(6)

    expect(await db.rankings.get(6)).toBeUndefined()
    expect(await db.shows.get(6)).toBeDefined()
  })

  it('cleans up an unfollowed, untouched show when its ranking is removed', async () => {
    await db.shows.put(show(7, { followed: false }))
    await db.rankings.put(ranking(7, 'fine', 1500))
    await removeRanking(7)
    expect(await db.shows.get(7)).toBeUndefined()
  })
})

describe('rankings', () => {
  it('saves a new ranking, stores the show, and nudges the shows it was compared with', async () => {
    await db.shows.put(show(20))
    await db.rankings.put(ranking(20, 'liked', 1840))
    const newShow = show(21, { followed: false })

    await saveRanking(newShow, { bucket: 'liked', rating: 1900, comparisons: 1, opponents: new Map([[20, 1830]]) })

    expect(await db.shows.get(21)).toBeDefined()
    expect(await db.rankings.get(21)).toMatchObject({ bucket: 'liked', rating: 1900, comparisons: 1, score: 9 })
    expect(await db.rankings.get(20)).toMatchObject({ rating: 1830, comparisons: 1, score: 8.3 })
  })

  it('keeps scores inside the bucket even when the rating overshoots', async () => {
    await saveRanking(show(22), { bucket: 'fine', rating: 1900, comparisons: 6, opponents: new Map() })
    expect((await db.rankings.get(22))?.score).toBe(6.7)
  })

  it('Keep comparing moves both shows, and Undo puts them back exactly', async () => {
    await db.rankings.bulkPut([ranking(30, 'liked', 1840), ranking(31, 'liked', 1840)])

    const before = await saveComparison(30, 31, 1)
    const a = await db.rankings.get(30)
    const b = await db.rankings.get(31)
    expect(a!.rating).toBeGreaterThan(1840)
    expect(b!.rating).toBeLessThan(1840)
    expect(a!.comparisons).toBe(1)

    await restoreRankings(before)
    expect(await db.rankings.get(30)).toEqual(ranking(30, 'liked', 1840))
    expect(await db.rankings.get(31)).toEqual(ranking(31, 'liked', 1840))
  })
})

describe('rate when finished', () => {
  beforeEach(async () => {
    await db.shows.put(show(40, { status: 'Ended' }))
    await db.episodes.bulkPut([ep(40, 1, 1), ep(40, 1, 2)])
  })

  it('offers to rate an ended, unranked show when you tick its last episode', async () => {
    await setWatched([ep(40, 1, 1)], true)
    expect(ratePromptStore.get()).toBeNull()
    await setWatched([ep(40, 1, 2)], true)
    expect(ratePromptStore.get()).toBe(40)
  })

  it("doesn't offer when the caller is about to rate anyway", async () => {
    await setWatched([ep(40, 1, 1), ep(40, 1, 2)], true, { promptToRate: false })
    expect(ratePromptStore.get()).toBeNull()
  })

  it("doesn't offer for a show that's already ranked", async () => {
    await db.rankings.put(ranking(40, 'liked', 1840))
    await setWatched([ep(40, 1, 1), ep(40, 1, 2)], true)
    expect(ratePromptStore.get()).toBeNull()
  })

  it("doesn't offer for a show that's still coming back", async () => {
    await db.shows.update(40, { status: 'Returning Series' })
    await setWatched([ep(40, 1, 1), ep(40, 1, 2)], true)
    expect(ratePromptStore.get()).toBeNull()
  })
})

describe('backups', () => {
  it('round-trips shows, episodes, rankings and ticks, but not "where to stream"', async () => {
    await db.shows.put(show(50, { streaming: [{ id: 8, name: 'Netflix', logo_path: null }], own_dvd: true }))
    await db.episodes.bulkPut([ep(50, 1, 1, 30, { runtime: 43, runtime_checked: true })])
    await db.rankings.put(ranking(50, 'liked', 1900))
    await setWatched([ep(50, 1, 1)], true, { promptToRate: false })

    const text = await (await buildBackup({ region: 'GB', theme: 'dark' })).text()
    expect(JSON.parse(text).shows[0]).not.toHaveProperty('streaming')
    expect(JSON.parse(text)).not.toHaveProperty('settings.tmdbKey')
    expect(parseBackup(text).settings).toEqual({ region: 'GB', theme: 'dark' })

    await db.shows.put(show(99)) // something that should disappear on restore
    await restoreBackup(parseBackup(text))

    expect(await db.shows.get(99)).toBeUndefined()
    expect(await db.shows.get(50)).toMatchObject({ own_dvd: true, streaming: [] })
    expect(await db.episodes.get(ep(50, 1, 1).id)).toMatchObject({ runtime: 43, runtime_checked: true })
    expect(await db.rankings.get(50)).toMatchObject({ rating: 1900, score: 9 })
    expect(await db.watched.get(episodeKey(50, 1, 1))).toBeDefined()
  })

  it('ignores the streaming list in older backups that still have one', async () => {
    const old = parseBackup(
      JSON.stringify({
        app: 'show-tracker',
        version: 2,
        shows: [{ tmdb_id: 1, name: 'A', streaming: [null, 'junk'] }],
        episodes: [],
        rankings: [],
      }),
    )
    expect(old.shows[0].streaming).toEqual([])
  })
})

describe('refreshing a show', () => {
  const tvmazeEpisodes = () => [ep(60, 1, 1, 30, { runtime: 60 }), ep(60, 1, 2, 20, { runtime: 60 }), ep(60, 2, 1, -5, { runtime: 60 })]

  beforeEach(async () => {
    await db.shows.put(show(60))
    vi.mocked(getShowDetails).mockResolvedValue(details(60))
    // A fresh array each call, as the real API would give.
    vi.mocked(getEpisodes).mockImplementation(async () => tvmazeEpisodes())
    vi.mocked(getEpisodeRuntimes).mockResolvedValue(
      new Map([
        ['1:1', 43],
        ['1:2', 44],
      ]),
    )
  })

  it("takes streaming services from the API and TMDB's real runtimes, asking TMDB only once", async () => {
    await refreshShow(60)

    expect(getEpisodeRuntimes).toHaveBeenCalledWith(60, [1]) // only seasons that have aired
    expect((await db.shows.get(60))?.streaming).toEqual([{ id: 8, name: 'Netflix', logo_path: null }])
    expect((await db.episodes.get(ep(60, 1, 1).id))?.runtime).toBe(43)
    expect((await db.episodes.get(ep(60, 2, 1).id))?.runtime).toBe(60) // not aired yet: TVmaze's for now

    await refreshShow(60)
    expect(getEpisodeRuntimes).toHaveBeenCalledTimes(1)
    expect((await db.episodes.get(ep(60, 1, 2).id))?.runtime).toBe(44)
  })

  it('keeps your ticks when the episode list is replaced', async () => {
    await refreshShow(60)
    await setWatched([ep(60, 1, 1)], true, { promptToRate: false })
    await refreshShow(60)
    expect(await db.watched.get(episodeKey(60, 1, 1))).toBeDefined()
  })

  it("looks the show up again when TVmaze no longer knows its id", async () => {
    vi.mocked(getEpisodes).mockImplementation(async (tvmazeId) => (tvmazeId === 160 ? null : tvmazeEpisodes()))
    vi.mocked(lookupTvmazeId).mockResolvedValue(999)
    await refreshShow(60)
    expect((await db.shows.get(60))?.tvmaze_id).toBe(999)
    expect(await db.episodes.where('tmdb_show_id').equals(60).count()).toBe(3)
  })

  it("keeps the episodes it has when TVmaze can't find the show at all", async () => {
    await refreshShow(60)
    vi.mocked(getEpisodes).mockResolvedValue(null)
    vi.mocked(lookupTvmazeId).mockResolvedValue(null)
    await refreshShow(60)
    expect(await db.episodes.where('tmdb_show_id').equals(60).count()).toBe(3)
    expect((await db.shows.get(60))?.tvmaze_id).toBeNull() // tries a fresh lookup next time
    await refreshShow(60)
    expect(await db.episodes.where('tmdb_show_id').equals(60).count()).toBe(3)
  })

  it('leaves shows you no longer follow alone', async () => {
    await db.shows.update(60, { followed: false })
    await refreshShow(60)
    expect(getShowDetails).not.toHaveBeenCalled()
  })
})

describe('upgrading from an older version of the app', () => {
  it('converts old rankings to ratings with the same scores and refreshes followed shows', async () => {
    db.close()
    await db.delete()
    // The very first version of the database (Dexie version 1 = IndexedDB version 10).
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('show-tracker', 10)
      req.onupgradeneeded = () => {
        const d = req.result
        d.createObjectStore('shows', { keyPath: 'tmdb_id' })
        const episodes = d.createObjectStore('episodes', { keyPath: 'id' })
        episodes.createIndex('tmdb_show_id', 'tmdb_show_id')
        episodes.createIndex('airstamp', 'airstamp')
        d.createObjectStore('rankings', { keyPath: 'tmdb_show_id' }).createIndex('bucket', 'bucket')
        d.createObjectStore('meta', { keyPath: 'key' })
        req.transaction!.objectStore('shows').put(show(70))
        req.transaction!.objectStore('rankings').put({ tmdb_show_id: 70, bucket: 'liked', position: 1, score: 8.4, ranked_at: '' })
      }
      req.onsuccess = () => {
        req.result.close()
        resolve()
      }
      req.onerror = () => reject(req.error)
    })

    await db.open()

    const r = await db.rankings.get(70)
    expect(r).toMatchObject({ rating: 1840, comparisons: 0, score: 8.4 })
    expect(r).not.toHaveProperty('position')
    expect((await db.shows.get(70))?.last_refreshed_at).toBeNull()
    expect(await db.watched.count()).toBe(0)
  })
})
