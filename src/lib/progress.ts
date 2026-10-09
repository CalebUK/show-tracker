import { episodeKey, type Episode, type Show, type Watched } from '../db'
import { formatDateOnly } from './dates'
import { isOngoing } from './tmdb'

/** Season, then episode number. Specials without a number go last in their season. */
export function byEpisodeOrder(a: Episode, b: Episode) {
  return a.season - b.season || (a.number ?? Infinity) - (b.number ?? Infinity)
}

export const isAired = (ep: Episode, now: Date) => ep.number != null && Date.parse(ep.airstamp) <= now.getTime()

export interface Progress {
  /** Aired, numbered episodes. */
  aired: number
  /** How many of those you've ticked. */
  watched: number
  /** First aired episode you haven't ticked, in season/episode order. */
  next: Episode | null
  /** Aired episodes you haven't ticked. */
  left: number
  /** At least one episode ticked. Shows with nothing ticked count as "not started". */
  started: boolean
  /** Started, and every aired episode is ticked. */
  caughtUp: boolean
  lastWatchedAt: string | null
}

/** `episodes` are one show's episodes in any order; `watched` are that show's ticks. */
export function progressFor(episodes: Episode[], watched: Watched[], now = new Date()): Progress {
  const seen = new Set(watched.map((w) => w.id))
  const aired = episodes.filter((e) => isAired(e, now)).sort(byEpisodeOrder)
  const unwatched = aired.filter((e) => !seen.has(episodeKey(e.tmdb_show_id, e.season, e.number!)))
  const started = watched.length > 0
  return {
    aired: aired.length,
    watched: aired.length - unwatched.length,
    next: unwatched[0] ?? null,
    left: unwatched.length,
    started,
    caughtUp: started && unwatched.length === 0,
    lastWatchedAt: watched.reduce<string | null>((max, w) => (!max || w.watched_at > max ? w.watched_at : max), null),
  }
}

/** What TMDB knows about what's next, for shows with nothing on the schedule. */
export function nextSeasonNote(show: Show) {
  const next = show.next_air
  if (next?.date) {
    const when = formatDateOnly(next.date)
    return next.number === 1 ? `Season ${next.season} starts ${when}` : `Next episode ${when}`
  }
  if (show.status === 'Ended') return 'Ended'
  if (show.status === 'Canceled') return 'Cancelled'
  if (show.latest_season && show.last_aired_season && show.latest_season > show.last_aired_season) {
    return `Season ${show.latest_season} announced, no date yet`
  }
  if (show.in_production) return 'In production, no date yet'
  if (isOngoing(show.status)) return 'Returning, no date yet'
  return show.status || 'No news yet'
}
