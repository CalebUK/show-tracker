import { describe, expect, it } from 'vitest'
import type { Bucket } from '../db'
import { eloUpdate, expectedScore, kFor, pickOpponent, questionCount, ratingToScore, rawScore, scoreToRating, startingRating, suggestedBucket } from './elo'

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

describe('question settings', () => {
  it('asks the chosen number of questions, capped by how many shows are ranked', () => {
    expect(questionCount(6, 40)).toBe(6)
    expect(questionCount(15, 40)).toBe(15)
    expect(questionCount(15, 4)).toBe(4)
    expect(questionCount('all', 40)).toBe(40)
    expect(questionCount('all', 0)).toBe(0)
  })

  it('takes big steps for the first 6 answers, then smaller ones', () => {
    expect(kFor(0, false)).toBe(64)
    expect(kFor(5, false)).toBe(64)
    expect(kFor(6, false)).toBe(32)
    expect(kFor(0, true)).toBe(32)
  })
})

describe('suggestedBucket', () => {
  it('suggests nothing while the rating is inside its bucket', () => {
    expect(suggestedBucket('fine', scoreToRating(5))).toBeNull()
    expect(suggestedBucket('liked', scoreToRating(6.8))).toBeNull()
  })

  it('suggests the bucket the rating has moved into, up or down', () => {
    expect(suggestedBucket('fine', scoreToRating(7.2))).toBe('liked')
    expect(suggestedBucket('liked', scoreToRating(6.3))).toBe('fine')
    expect(suggestedBucket('fine', scoreToRating(2.9))).toBe('disliked')
    expect(suggestedBucket('disliked', scoreToRating(7.5))).toBe('liked')
  })

  it('rounds like the displayed score, so 6.75 counts as Liked', () => {
    expect(suggestedBucket('fine', scoreToRating(6.75))).toBe('liked')
    expect(rawScore(scoreToRating(6.74))).toBe(6.7)
  })
})
