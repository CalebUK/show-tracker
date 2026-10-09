import { describe, expect, it } from 'vitest'
import { comparisonsLeft, isPlaced, narrow, scoreFor, type SearchRange } from './ranking'

describe('scoreFor', () => {
  it('gives a lone show the top of its range', () => {
    expect(scoreFor('liked', 0, 1)).toBe(10)
    expect(scoreFor('fine', 0, 1)).toBe(6.7)
    expect(scoreFor('disliked', 0, 1)).toBe(3.3)
  })

  it('spreads shows evenly from top to bottom', () => {
    expect([0, 1, 2].map((p) => scoreFor('liked', p, 3))).toEqual([10, 8.4, 6.8])
    expect([0, 1, 2, 3].map((p) => scoreFor('disliked', p, 4))).toEqual([3.3, 2.2, 1.1, 0])
  })

  it('rounds to one decimal', () => {
    for (let p = 0; p < 7; p++) {
      const s = scoreFor('fine', p, 7)
      expect(Math.round(s * 10) / 10).toBe(s)
    }
  })
})

/** Run the binary insertion against a hidden "true" ordering, the way the UI does. */
function insert(bucket: number[], newShow: number) {
  let range: SearchRange = { low: 0, high: bucket.length }
  let comparisons = 0
  while (!isPlaced(range)) {
    const mid = Math.floor((range.low + range.high) / 2)
    comparisons++
    range = narrow(range, newShow > bucket[mid]) // higher number = better show
  }
  return { index: range.low, comparisons }
}

describe('binary insertion', () => {
  it('places a show at the right spot in a best-first list', () => {
    const bucket = [90, 70, 50, 30, 10]
    expect(insert(bucket, 100).index).toBe(0)
    expect(insert(bucket, 60).index).toBe(2)
    expect(insert(bucket, 5).index).toBe(5)
  })

  it('needs about 7 comparisons for 100 shows', () => {
    const bucket = Array.from({ length: 100 }, (_, i) => 1000 - i * 10)
    for (const v of [1001, 995, 500, 3, 455]) {
      expect(insert(bucket, v).comparisons).toBeLessThanOrEqual(7)
    }
  })

  it('estimates comparisons left', () => {
    expect(comparisonsLeft({ low: 0, high: 0 })).toBe(0)
    expect(comparisonsLeft({ low: 0, high: 1 })).toBe(1)
    expect(comparisonsLeft({ low: 0, high: 100 })).toBe(7)
  })
})
