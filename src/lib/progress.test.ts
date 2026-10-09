import { describe, expect, it } from 'vitest'
import { episodeKey, type Episode, type Show, type Watched } from '../db'
import { nextSeasonNote, progressFor } from './progress'

const now = new Date('2026-10-09T12:00:00Z')
let id = 1
const ep = (season: number, number: number | null, daysFromNow: number): Episode => ({
  id: id++,
  tmdb_show_id: 7,
  season,
  number,
  name: `S${season}E${number}`,
  airstamp: new Date(now.getTime() + daysFromNow * 86_400_000).toISOString(),
  has_time: true,
})
const seen = (season: number, number: number, at = '2026-10-01T00:00:00Z'): Watched => ({
  id: episodeKey(7, season, number),
  tmdb_show_id: 7,
  season,
  number,
  watched_at: at,
})

// Deliberately out of order, with a special and a future episode.
const episodes = [ep(2, 1, -10), ep(1, 2, -40), ep(1, 1, -50), ep(1, null, -45), ep(2, 2, 5)]

describe('progressFor', () => {
  it('treats a show with no ticks as not started, next = first aired episode', () => {
    const p = progressFor(episodes, [], now)
    expect(p).toMatchObject({ aired: 3, watched: 0, left: 3, started: false, caughtUp: false })
    expect(p.next?.name).toBe('S1E1')
  })

  it('finds the first unwatched episode in season order, ignoring air order', () => {
    const p = progressFor(episodes, [seen(1, 1, '2026-10-02T00:00:00Z'), seen(1, 2, '2026-10-05T00:00:00Z')], now)
    expect(p).toMatchObject({ watched: 2, left: 1, started: true, caughtUp: false, lastWatchedAt: '2026-10-05T00:00:00Z' })
    expect(p.next?.name).toBe('S2E1')
  })

  it('is caught up when every aired episode is ticked, even with future ones scheduled', () => {
    const p = progressFor(episodes, [seen(1, 1), seen(1, 2), seen(2, 1)], now)
    expect(p).toMatchObject({ left: 0, next: null, caughtUp: true })
  })
})

const base: Show = {
  tmdb_id: 7,
  tvmaze_id: 1,
  imdb_id: null,
  name: 'X',
  poster_path: null,
  overview: '',
  status: 'Returning Series',
  network: null,
  streaming: [],
  first_air_year: null,
  followed: true,
  followed_at: null,
  last_refreshed_at: null,
}

describe('nextSeasonNote', () => {
  it('uses the announced premiere date when TMDB has one', () => {
    expect(nextSeasonNote({ ...base, next_air: { date: '2027-03-12', season: 6, number: 1 } })).toMatch(/^Season 6 starts /)
    expect(nextSeasonNote({ ...base, next_air: { date: '2027-03-12', season: 5, number: 4 } })).toMatch(/^Next episode /)
  })

  it('spots a season that is listed but not dated', () => {
    expect(nextSeasonNote({ ...base, latest_season: 6, last_aired_season: 5 })).toBe('Season 6 announced, no date yet')
  })

  it('falls back on production and status', () => {
    expect(nextSeasonNote({ ...base, in_production: true })).toBe('In production, no date yet')
    expect(nextSeasonNote(base)).toBe('Returning, no date yet')
    expect(nextSeasonNote({ ...base, status: 'Ended' })).toBe('Ended')
    expect(nextSeasonNote({ ...base, status: 'Canceled' })).toBe('Cancelled')
  })
})
