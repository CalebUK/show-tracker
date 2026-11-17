import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookupTvmazeId } from './tvmaze'

/** Fake TVmaze: id lookups 404, searches return the given shows. */
function fakeTvmaze(searchResults: { id: number; name: string; premiered: string | null }[]) {
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/search/shows')) return new Response(JSON.stringify(searchResults.map((show) => ({ show }))), { status: 200 })
    return new Response('', { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('lookupTvmazeId by name', () => {
  it('finds a show with no shared ids by its name and premiere date', async () => {
    fakeTvmaze([{ id: 68626, name: 'Monsters: The Lyle and Erik Menendez Story', premiered: '2024-09-19' }])
    const id = await lookupTvmazeId(null, null, { name: 'Monsters: The Lyle and Erik Menendez Story', firstAired: '2024-09-19' })
    expect(id).toBe(68626)
  })

  it('tells same-named shows apart by when they premiered', async () => {
    fakeTvmaze([
      { id: 526, name: 'The Office', premiered: '2005-03-24' },
      { id: 527, name: 'The Office', premiered: '2001-07-09' },
    ])
    expect(await lookupTvmazeId(null, null, { name: 'The Office', firstAired: '2001-07-09' })).toBe(527)
  })

  it("won't guess without a premiere date, or when the dates are far apart", async () => {
    const fetch = fakeTvmaze([{ id: 1, name: 'Ghosts', premiered: '2021-10-07' }])
    expect(await lookupTvmazeId(null, null, { name: 'Ghosts', firstAired: null })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(await lookupTvmazeId(null, null, { name: 'Ghosts', firstAired: '2019-04-15' })).toBeNull()
  })

  it('prefers the IMDb id when there is one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('imdb=') ? new Response(JSON.stringify({ id: 42 }), { status: 200 }) : new Response('', { status: 404 }))),
    )
    expect(await lookupTvmazeId('tt123', null, { name: 'Anything', firstAired: '2020-01-01' })).toBe(42)
  })
})
