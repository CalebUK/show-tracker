import { describe, expect, it } from 'vitest'
import { parseBackup } from './backup'

const valid = {
  app: 'show-tracker',
  version: 1,
  exported_at: '2026-10-09T10:00:00.000Z',
  shows: [{ tmdb_id: 1, name: 'A', followed: true, own_dvd: true }, { tmdb_id: 2, name: 'B' }],
  episodes: [{ id: 10, tmdb_show_id: 1, season: 1, number: 2, name: 'x', airstamp: '2026-10-10T01:00:00+00:00' }],
  rankings: [{ tmdb_show_id: 2, bucket: 'liked', position: 0, score: 10, ranked_at: '2026-10-01T00:00:00.000Z' }],
}

describe('parseBackup', () => {
  it('accepts a valid backup and fills in defaults', () => {
    const b = parseBackup(JSON.stringify(valid))
    expect(b.shows[0]).toMatchObject({ own_dvd: true, own_streaming: false })
    expect(b.shows[1]).toMatchObject({ tmdb_id: 2, followed: false, streaming: [], tvmaze_id: null, own_dvd: false })
    expect(b.episodes[0].airstamp).toBe('2026-10-10T01:00:00.000Z')
  })

  it('reads watched episodes from version 2 and treats version 1 as having none', () => {
    expect(parseBackup(JSON.stringify(valid)).watched).toEqual([])
    const b = parseBackup(
      JSON.stringify({ ...valid, version: 2, watched: [{ tmdb_show_id: 1, season: 2, number: 3, watched_at: '2026-10-01T00:00:00Z' }] }),
    )
    expect(b.watched).toEqual([{ id: '1:2:3', tmdb_show_id: 1, season: 2, number: 3, watched_at: '2026-10-01T00:00:00Z' }])
    expect(() => parseBackup(JSON.stringify({ ...valid, version: 2, watched: [{ tmdb_show_id: 1 }] }))).toThrow(/Watched episode #1/)
  })

  it('rejects things that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow(/valid JSON/)
    expect(() => parseBackup('{"app":"other"}')).toThrow(/Show Tracker backup/)
    expect(() => parseBackup(JSON.stringify({ ...valid, shows: 'x' }))).toThrow(/missing/)
    expect(() => parseBackup(JSON.stringify({ ...valid, rankings: [{ ...valid.rankings[0], bucket: 'meh' }] }))).toThrow(/Ranking #1/)
    expect(() => parseBackup(JSON.stringify({ ...valid, rankings: [{ ...valid.rankings[0], tmdb_show_id: 3 }] }))).toThrow(/isn't in the backup/)
  })
})

describe('rankings in backups', () => {
  it('converts old position-based rankings to ratings without changing their scores', () => {
    const b = parseBackup(JSON.stringify(valid)) // version 1: score 10, no rating
    expect(b.rankings[0]).toMatchObject({ bucket: 'liked', rating: 2000, comparisons: 0, score: 10 })
  })

  it('keeps ratings from new backups and recomputes the score from them', () => {
    const b = parseBackup(
      JSON.stringify({ ...valid, version: 3, rankings: [{ tmdb_show_id: 2, bucket: 'fine', rating: 1580, comparisons: 4, score: 99 }] }),
    )
    expect(b.rankings[0]).toMatchObject({ rating: 1580, comparisons: 4, score: 5.8 })
  })
})

describe('settings in backups', () => {
  const settings = {
    region: 'GB',
    services: [{ id: 8, name: 'Netflix', logo_path: '/n.png' }],
    onAirFilter: 'caughtUp',
    trackingView: 'onair',
    rankingQuestions: 'all',
    theme: 'dark',
  }

  it('reads them from version 4', () => {
    expect(parseBackup(JSON.stringify({ ...valid, version: 4, settings })).settings).toEqual(settings)
  })

  it('has none in older backups, so this phone keeps its own', () => {
    expect(parseBackup(JSON.stringify({ ...valid, version: 3 })).settings).toEqual({})
  })

  it('drops anything malformed instead of rejecting the backup', () => {
    const junk = { region: 'Britain', services: [{ id: 'x' }, { id: 9, name: 'Prime' }, null], onAirFilter: 'some', trackingView: 1, rankingQuestions: 7, theme: 'pink' }
    expect(parseBackup(JSON.stringify({ ...valid, version: 4, settings: junk })).settings).toEqual({
      services: [{ id: 9, name: 'Prime', logo_path: null }],
    })
    expect(parseBackup(JSON.stringify({ ...valid, version: 4, settings: { region: '' } })).settings).toEqual({ region: '' })
  })

  it('rejects versions from a newer app', () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, version: 5 }))).toThrow(/Unsupported backup version: 5/)
  })
})
