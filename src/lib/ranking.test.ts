import { describe, expect, it } from 'vitest'
import type { Bucket } from '../db'
import { eloUpdate, expectedScore, pickOpponent, ratingToScore, scoreToRating, startingRating } from './elo'

describe('scores and ratings', () => {
  it('maps 1500 to 5.0 and 100 points to one point of score', () => {
    expect(ratingToScore('fine', 1500)).toBe(5)
    expect(ratingToScore('liked', 1840)).toBe(8.4)
    expect(scoreToRating(8.4)).toBeCloseTo(1840)
  })

  it('keeps scores inside the bucket range', () => {
    expect(ratingToScore('liked', 2400)).toBe(10)
    expect(ratingToScore('liked', 1200)).toBe(6.8)
    expect(ratingToScore('fine', 1900)).toBe(6.7)
    expect(ratingToScore('disliked', 1500)).toBe(3.3)
    expect(ratingToScore('disliked', 500)).toBe(0)
  })

  it('starts new shows in the middle of their bucket', () => {
    expect(ratingToScore('liked', startingRating('liked'))).toBe(8.4)
    expect(ratingToScore('fine', startingRating('fine'))).toBe(5.1)
    expect(ratingToScore('disliked', startingRating('disliked'))).toBe(1.7)
  })
})

describe('eloUpdate', () => {
  it('moves the winner up and the loser down', () => {
    const [a, b] = eloUpdate(1500, 1500, 1, 32, 32)
    expect(a).toBe(1516)
    expect(b).toBe(1484)
  })

  it('treats too close to call between equals as no change', () => {
    expect(eloUpdate(1600, 1600, 0.5, 64, 16)).toEqual([1600, 1600])
  })

  it('rewards an upset more than an expected win', () => {
    const [underdog] = eloUpdate(1400, 1600, 1, 32, 32)
    const [favourite] = eloUpdate(1600, 1400, 1, 32, 32)
    expect(underdog - 1400).toBeGreaterThan(favourite - 1600)
    expect(expectedScore(1600, 1400)).toBeCloseTo(0.76, 2)
  })
})

describe('pickOpponent', () => {
  const pool: { id: number; rating: number; bucket: Bucket }[] = [
    { id: 1, rating: 1900, bucket: 'liked' },
    { id: 2, rating: 1820, bucket: 'liked' },
    { id: 3, rating: 1830, bucket: 'fine' },
    { id: 4, rating: 1500, bucket: 'fine' },
  ]

  it('picks the closest rating, preferring the same bucket', () => {
    expect(pickOpponent(1840, 'liked', pool, new Set())?.id).toBe(2)
  })

  it('skips shows already compared and returns null when none are left', () => {
    expect(pickOpponent(1840, 'liked', pool, new Set([2]))?.id).toBe(1)
    expect(pickOpponent(1840, 'liked', pool, new Set([1, 2, 3, 4]))).toBeNull()
  })
})

describe('a full ranking', () => {
  // Rank a new Liked show against six shows by answering from a hidden "true" preference.
  function rank(trueQuality: number) {
    let pool = [1960, 1900, 1860, 1820, 1780, 1720].map((rating, i) => ({ id: i, rating, bucket: 'liked' as Bucket, quality: 90 - i * 10 }))
    let rating = startingRating('liked')
    const used = new Set<number>()
    for (let q = 0; q < 6; q++) {
      const opp = pickOpponent(rating, 'liked', pool, used)!
      const [r, o] = eloUpdate(rating, opp.rating, trueQuality > opp.quality ? 1 : 0, 64, 16)
      rating = r
      pool = pool.map((p) => (p.id === opp.id ? { ...p, rating: o } : p))
      used.add(opp.id)
    }
    return ratingToScore('liked', rating)
  }

  it('scores a show you prefer to everything near the top, and one you prefer to nothing near the bottom', () => {
    const best = rank(100)
    const worst = rank(0)
    const middle = rank(65)
    expect(best).toBeGreaterThan(9.5)
    expect(worst).toBeLessThan(7.3)
    expect(middle).toBeGreaterThan(worst)
    expect(middle).toBeLessThan(best)
  })
})
