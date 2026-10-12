import type { BeforeSend } from '@vercel/analytics/react'
import { parseRoute, routePattern } from './router'

/**
 * Vercel Web Analytics sees screens, not shows: "/#/show/2710" is reported as "/show/[id]".
 * (Hash routes would otherwise all count as "/".)
 */
export const screenOnlyUrl: BeforeSend = (event) => {
  const url = new URL(event.url)
  return { ...event, url: url.origin + routePattern(parseRoute(url.hash)) }
}
