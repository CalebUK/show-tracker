import { describe, expect, it } from 'vitest'
import type { Provider, Show } from '../db'
import { canStream, foldVariants, sameService, servicesOnShows, whereToWatch } from './services'

const p = (id: number, name: string): Provider => ({ id, name, logo_path: null })
const netflix = p(8, 'Netflix')
const netflixAds = p(1796, 'Netflix Standard with Ads')
const prime = p(9, 'Amazon Prime Video')
const iplayer = p(38, 'BBC iPlayer')
const five = p(333, '5')
const show = (id: number, streaming: Provider[], extra: Partial<Show> = {}) => ({ tmdb_id: id, name: `Show ${id}`, streaming, ...extra }) as Show

describe('sameService', () => {
  it('matches a service with its variants, either way round', () => {
    expect(sameService(netflixAds, netflix)).toBe(true)
    expect(sameService(netflix, netflixAds)).toBe(true)
    expect(sameService(p(196, 'AcornTV Amazon Channel'), p(87, 'Acorn TV'))).toBe(true)
  })

  it('treats "+" as "plus"', () => {
    expect(sameService(p(582, 'Paramount+ Amazon Channel'), p(531, 'Paramount Plus'))).toBe(true)
    expect(sameService(p(1, 'Disney+'), p(337, 'Disney Plus'))).toBe(true)
  })

  it("doesn't match different services", () => {
    expect(sameService(netflix, prime)).toBe(false)
    expect(sameService(p(29, 'Sky Go'), p(130, 'Sky Store'))).toBe(false)
  })

  it('only matches very short names exactly', () => {
    expect(sameService(five, p(999, '5 Select'))).toBe(false)
    expect(sameService(five, p(1000, '5'))).toBe(true)
  })
})

describe('foldVariants', () => {
  it('keeps the main service and drops its variants', () => {
    expect(foldVariants([netflixAds, prime, netflix])).toEqual([prime, netflix])
  })

  it('keeps a variant when the main service is missing', () => {
    expect(foldVariants([netflixAds, prime])).toEqual([netflixAds, prime])
  })
})

describe('canStream', () => {
  it('counts shows on one of your services, including variants', () => {
    expect(canStream(show(1, [netflix]), [netflix])).toBe(true)
    expect(canStream(show(2, [netflixAds]), [netflix])).toBe(true)
    expect(canStream(show(3, [iplayer]), [netflix])).toBe(false)
  })

  it('counts shows you own on DVD or streaming, whatever they are on', () => {
    expect(canStream(show(4, [], { own_dvd: true }), [])).toBe(true)
    expect(canStream(show(5, [iplayer], { own_streaming: true }), [netflix])).toBe(true)
    expect(canStream(show(6, []), [netflix])).toBe(false)
  })

  it('copes with shows that have no streaming list (e.g. from an old backup)', () => {
    expect(canStream({ tmdb_id: 7, name: 'Old' } as Show, [netflix])).toBe(false)
  })
})

describe('whereToWatch', () => {
  it('lists your services, then what you own', () => {
    expect(whereToWatch(show(1, [netflix, iplayer, prime], { own_dvd: true }), [iplayer, netflix])).toBe('BBC iPlayer · Netflix · Own on DVD')
  })
})

describe('servicesOnShows', () => {
  it('folds variants and counts shows, most first', () => {
    const shows = [show(1, [netflix]), show(2, [netflixAds, iplayer]), show(3, [iplayer]), show(4, [netflix, prime])]
    expect(servicesOnShows(shows)).toEqual([
      { service: netflix, count: 3 },
      { service: iplayer, count: 2 },
      { service: prime, count: 1 },
    ])
  })
})
