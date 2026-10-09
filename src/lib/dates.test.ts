import { describe, expect, it } from 'vitest'
import type { Episode, Show } from '../db'
import { episodeLabel, groupUpcoming } from './dates'

const show = (id: number): Show => ({
  tmdb_id: id,
  tvmaze_id: id,
  imdb_id: null,
  name: `Show ${id}`,
  poster_path: null,
  overview: '',
  status: 'Returning Series',
  network: null,
  streaming: [],
  first_air_year: null,
  followed: true,
  followed_at: null,
  last_refreshed_at: null,
})

let nextId = 1
const ep = (showId: number, at: Date, season = 1, number = 1): Episode => ({
  id: nextId++,
  tmdb_show_id: showId,
  season,
  number,
  name: `Ep ${number}`,
  airstamp: at.toISOString(),
  has_time: true,
})

const now = new Date(2026, 9, 9, 12, 0) // Fri 9 Oct 2026, noon local
const at = (days: number, hour = 21) => new Date(2026, 9, 9 + days, hour, 0)

describe('groupUpcoming', () => {
  const shows = new Map([1, 2, 3].map((id) => [id, show(id)]))

  it('splits into today, this week and later', () => {
    const eps = [ep(1, at(0, 9)), ep(1, at(0)), ep(2, at(3)), ep(2, at(6, 23)), ep(3, at(7, 0)), ep(3, at(14))]
    const g = groupUpcoming(eps, shows, now)
    expect(g.today.map((r) => r.show.tmdb_id)).toEqual([1, 1])
    expect(g.week.map((r) => r.show.tmdb_id)).toEqual([2, 2])
    // Later only shows each show's next episode.
    expect(g.later.map((r) => r.episodes[0].airstamp)).toEqual([at(7, 0).toISOString()])
  })

  it('leaves shows already listed this week out of Later', () => {
    const g = groupUpcoming([ep(1, at(2)), ep(1, at(9))], shows, now)
    expect(g.week).toHaveLength(1)
    expect(g.later).toHaveLength(0)
  })

  it('collapses a binge drop into one row', () => {
    const drop = at(1, 3)
    const g = groupUpcoming([ep(2, drop, 2, 3), ep(2, drop, 2, 1), ep(2, drop, 2, 2)], shows, now)
    expect(g.week).toHaveLength(1)
    expect(episodeLabel(g.week[0].episodes)).toBe('S2 E1–3')
  })

  it('ignores episodes from earlier days and unfollowed shows', () => {
    const g = groupUpcoming([ep(1, at(-1)), ep(99, at(1))], shows, now)
    expect(g.today.length + g.week.length + g.later.length).toBe(0)
  })
})
