import { describe, expect, it } from 'vitest'
import { normalizeRankings, parseBackup } from './backup'

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

describe('normalizeRankings', () => {
  it('renumbers positions and recomputes scores per bucket', () => {
    const out = normalizeRankings([
      { tmdb_show_id: 1, bucket: 'fine', position: 5, score: 0, ranked_at: '' },
      { tmdb_show_id: 2, bucket: 'fine', position: 2, score: 0, ranked_at: '' },
    ])
    expect(out.map((r) => [r.tmdb_show_id, r.position, r.score])).toEqual([
      [2, 0, 6.7],
      [1, 1, 3.4],
    ])
  })
})
