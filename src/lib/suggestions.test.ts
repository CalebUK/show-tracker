import { describe, expect, it } from 'vitest'
import type { Ranking, Show } from '../db'
import { becauseLine, pickSeeds, rankSuggestions, type Seed } from './suggestions'
import type { Recommendation } from './tmdb'

const rec = (id: number, vote_average = 8, vote_count = 500): Recommendation => ({
  id,
  name: `Rec ${id}`,
  poster_path: null,
  first_air_year: '2024',
  vote_average,
  vote_count,
})
const seed = (id: number, weight: number): Seed => ({ id, name: `Seed ${id}`, weight })

describe('rankSuggestions', () => {
  it('puts shows recommended by several of your favourites first, with the reasons', () => {
    const recs = new Map([
      [1, [rec(100), rec(200)]],
      [2, [rec(200), rec(300)]],
    ])
    const out = rankSuggestions([seed(1, 1), seed(2, 0.8)], [], recs, new Set())
    expect(out.map((s) => s.id)).toEqual([200, 100, 300])
    expect(out[0].because).toEqual(['Seed 2', 'Seed 1']) // Seed 2 put it higher on its list
  })

  it('lets stronger favourites pull harder', () => {
    const recs = new Map([
      [1, [rec(100)]],
      [2, [rec(200)]],
    ])
    expect(rankSuggestions([seed(1, 0.3), seed(2, 1)], [], recs, new Set()).map((s) => s.id)).toEqual([200, 100])
  })

  it("pushes down shows that come up alongside ones you didn't like", () => {
    const recs = new Map([
      [1, [rec(100), rec(200)]],
      [9, [rec(100)]],
    ])
    expect(rankSuggestions([seed(1, 1)], [seed(9, 1)], recs, new Set()).map((s) => s.id)).toEqual([200, 100])
  })

  it('leaves out shows already in the app, hidden ones, and little-known ones', () => {
    const recs = new Map([[1, [rec(100), rec(200), rec(300, 9, 3)]]])
    expect(rankSuggestions([seed(1, 1)], [], recs, new Set([100])).map((s) => s.id)).toEqual([200])
  })

  it('weights by the global rating', () => {
    const recs = new Map([
      [1, [rec(100, 6)]],
      [2, [rec(200, 9)]],
    ])
    expect(rankSuggestions([seed(1, 1), seed(2, 1)], [], recs, new Set()).map((s) => s.id)).toEqual([200, 100])
  })
})

describe('pickSeeds', () => {
  const ranking = (id: number, score: number): Ranking => ({
    tmdb_show_id: id,
    bucket: score >= 6.8 ? 'liked' : score >= 3.4 ? 'fine' : 'disliked',
    rating: 1500,
    comparisons: 0,
    score,
    ranked_at: '',
  })
  const show = (id: number, extra: Partial<Show> = {}) => ({ tmdb_id: id, name: `Show ${id}`, ...extra }) as Show

  it('uses shows rated 6+ as likes and 3.3 or less as dislikes, but not ones kept out of rating', () => {
    const shows = new Map([1, 2, 3, 4, 5].map((id) => [id, show(id, id === 5 ? { person: 'kids' } : {})]))
    const { liked, disliked } = pickSeeds([ranking(1, 10), ranking(2, 7.5), ranking(3, 5), ranking(4, 1), ranking(5, 9)], shows)
    expect(liked).toEqual([
      { id: 1, name: 'Show 1', weight: 1 },
      { id: 2, name: 'Show 2', weight: 0.5 },
    ])
    expect(disliked).toEqual([{ id: 4, name: 'Show 4', weight: 0.8 }])
  })
})

describe('becauseLine', () => {
  it('names up to two shows, then counts the rest', () => {
    expect(becauseLine(['Ludwig'])).toBe('Because you liked Ludwig')
    expect(becauseLine(['Ludwig', 'Ted Lasso'])).toBe('Because you liked Ludwig and Ted Lasso')
    expect(becauseLine(['Ludwig', 'Ted Lasso', 'A', 'B'])).toBe('Because you liked Ludwig, Ted Lasso and 2 more')
  })
})
