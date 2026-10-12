import { describe, expect, it } from 'vitest'
import { screenOnlyUrl } from './analytics'

const send = (url: string) => screenOnlyUrl({ type: 'pageview', url })?.url

describe('screenOnlyUrl', () => {
  it('reports tabs by name, with the home screen as Tracking', () => {
    expect(send('https://example.app/#/shows')).toBe('https://example.app/shows')
    expect(send('https://example.app/')).toBe('https://example.app/tracking')
  })

  it('leaves out show IDs', () => {
    expect(send('https://example.app/#/show/2710')).toBe('https://example.app/show/[id]')
    expect(send('https://example.app/#/rank/84773')).toBe('https://example.app/rank/[id]')
  })
})
