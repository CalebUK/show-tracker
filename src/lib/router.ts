import { useEffect, useState } from 'react'

/**
 * Hash routing keeps the app working on any static host with no rewrite rules,
 * and lets Android's back button move between screens.
 */
export type Tab = 'tracking' | 'shows' | 'rankings' | 'search' | 'settings'

export type Route =
  | { name: Tab }
  | { name: 'show'; id: number }
  | { name: 'rank'; id: number }
  | { name: 'compare' }

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/')
  const id = Number(parts[1])
  switch (parts[0]) {
    case 'shows':
    case 'rankings':
    case 'search':
    case 'settings':
      return { name: parts[0] }
    case 'compare':
      return { name: 'compare' }
    case 'show':
    case 'rank':
      if (Number.isInteger(id) && id > 0) return { name: parts[0], id }
  }
  return { name: 'tracking' }
}

/** A route without its show ID: "/show/[id]". */
export const routePattern = (r: Route) => (r.name === 'show' || r.name === 'rank' ? `/${r.name}/[id]` : `/${r.name}`)

export const isTab = (r: Route): r is { name: Tab } => r.name !== 'show' && r.name !== 'rank' && r.name !== 'compare'

const depth = () => (history.state as { depth?: number } | null)?.depth ?? 0

/** Push a screen. Tabs replace instead, so back doesn't walk through every tab you touched. */
export function navigate(path: string, { replace = false } = {}) {
  if (replace) history.replaceState({ depth: depth() }, '', '#' + path)
  else history.pushState({ depth: depth() + 1 }, '', '#' + path)
  window.dispatchEvent(new Event('routechange'))
}

/** Go back if we pushed something, otherwise land on `fallback` (e.g. opened from a deep link). */
export function goBack(fallback = '/') {
  if (depth() > 0) history.back()
  else navigate(fallback, { replace: true })
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const update = () => setRoute(parseRoute(location.hash))
    window.addEventListener('popstate', update)
    window.addEventListener('hashchange', update)
    window.addEventListener('routechange', update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener('hashchange', update)
      window.removeEventListener('routechange', update)
    }
  }, [])
  return route
}
