import { describe, expect, it } from 'vitest'
import type { Episode } from '../db'
import { isOnCurrentSeason } from './onAir'
import { progressFor } from './progress'

const now = new Date('2026-10-12T12:00:00')
// Season 2 has aired in full; season 3 is airing weekly and episode 10 is out today.
const ep = (season: number, number: number, airstamp: string): Episode => ({
  id: season * 100 + number,
  tmdb_show_id: 1,
  season,
  number,
  name: '',
  airstamp: new Date(airstamp).toISOString(),
  has_time: true,
})
const season2 = Array.from({ length: 10 }, (_, i) => ep(2, i + 1, `2025-0${1 + Math.floor(i / 4)}-1${i % 4}T21:00:00`))
const season3 = Array.from({ length: 10 }, (_, i) => ep(3, i + 1, i === 9 ? '2026-10-12T09:00:00' : `2026-08-${10 + i}T21:00:00`))
const ticks = (...eps: Episode[]) => eps.map((e) => ({ id: `1:${e.season}:${e.number}`, tmdb_show_id: 1, season: e.season, number: e.number!, watched_at: '2026-10-01T00:00:00.000Z' }))
const onAir = (episodes: Episode[], ...watched: Episode[]) => isOnCurrentSeason(progressFor(episodes, ticks(...watched), now))

describe('isOnCurrentSeason', () => {
  it('counts a show with nothing left to watch', () => {
    expect(onAir([...season2, ...season3], season3[9])).toBe(true)
  })

  it('counts a show you are a few episodes behind on in the current season', () => {
    expect(onAir([...season2, ...season3], season3[0])).toBe(true)
  })

  it("doesn't count a show you are a season behind on, even with only 2 episodes of that season left", () => {
    expect(onAir([...season2, ...season3], season2[7])).toBe(false)
  })

  it("doesn't count a show you haven't started once it's past season 1", () => {
    expect(onAir([...season2, ...season3])).toBe(false)
  })

  it("goes by episodes aired before today, so a premiere doesn't hide a show on the day", () => {
    const premiereToday = [...season2, ep(3, 1, '2026-10-12T09:00:00')]
    expect(onAir(premiereToday, season2[7])).toBe(true)
  })

  it('counts a show with nothing aired yet', () => {
    expect(onAir([ep(1, 1, '2026-11-01T21:00:00')])).toBe(true)
  })
})
