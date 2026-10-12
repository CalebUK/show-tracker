import { describe, expect, it } from 'vitest'
import type { Episode } from '../db'
import { isCaughtUpForOnAir } from './onAir'
import type { Progress } from './progress'

const todayIso = '2026-10-12T00:00:00.000Z'
const ep = (airstamp: string): Episode => ({ id: 1, tmdb_show_id: 1, season: 1, number: 1, name: '', airstamp, has_time: true })
const progress = (next: Episode | null): Progress => ({
  aired: 10,
  watched: 5,
  next,
  left: next ? 1 : 0,
  started: true,
  caughtUp: !next,
  lastWatchedAt: null,
  minutesWatched: null,
  minutesLeft: null,
})

describe('isCaughtUpForOnAir', () => {
  it('counts a show with nothing left to watch', () => {
    expect(isCaughtUpForOnAir(progress(null), todayIso)).toBe(true)
  })

  it("doesn't count a show with an episode from before today still to watch", () => {
    expect(isCaughtUpForOnAir(progress(ep('2026-10-05T21:00:00.000Z')), todayIso)).toBe(false)
  })

  it("still counts a show whose only unwatched episode aired today, so live shows don't vanish on the day", () => {
    expect(isCaughtUpForOnAir(progress(ep('2026-10-12T20:00:00.000Z')), todayIso)).toBe(true)
  })
})
