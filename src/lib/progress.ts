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
  /** Total runtime of ticked episodes, in minutes. null when no runtimes are known. */
  minutesWatched: number | null
  /** Total runtime of the episodes still to watch (`left`), in minutes. */
  minutesLeft: number | null
}

/**
 * `episodes` are one show's episodes in any order; `watched` are that show's ticks.
 * "Where you're up to" is just after the furthest episode you've ticked, so episodes you
 * skipped before it (or never ticked because you watch live) don't count as still to watch.
 */
export function progressFor(episodes: Episode[], watched: Watched[], now = new Date()): Progress {
  const seen = new Set(watched.map((w) => w.id))
  const aired = episodes.filter((e) => isAired(e, now)).sort(byEpisodeOrder)
  const isSeen = (e: Episode) => seen.has(episodeKey(e.tmdb_show_id, e.season, e.number!))
  let furthest = -1
  aired.forEach((e, i) => {
    if (isSeen(e)) furthest = i
  })
  const remaining = aired.slice(furthest + 1)
  const started = watched.length > 0
  const minutes = runtimeTotal(episodes)
  return {
    aired: aired.length,
    watched: aired.filter(isSeen).length,
    next: remaining[0] ?? null,
    left: remaining.length,
    started,
    caughtUp: started && remaining.length === 0,
    lastWatchedAt: watched.reduce<string | null>((max, w) => (!max || w.watched_at > max ? w.watched_at : max), null),
    minutesWatched: minutes(aired.filter(isSeen)),
    minutesLeft: minutes(remaining),
  }
}

/**
 * Adds up episode runtimes. Episodes with no runtime count as the show's average episode
 * length; if no episode of the show has a runtime, the total is unknown (null).
 */
function runtimeTotal(allEpisodes: Episode[]) {
  const known = allEpisodes.map((e) => e.runtime).filter((r): r is number => typeof r === 'number' && r > 0)
  const average = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null
  return (list: Episode[]) => (average == null ? null : Math.round(list.reduce((sum, e) => sum + (e.runtime || average), 0)))
}

const isOver = (show: Show) => show.status === 'Ended' || show.status === 'Canceled'

/** Done for good: the show has ended (or been cancelled) and you've seen every episode. */
export const isFinished = (show: Show, progress: Progress) => progress.caughtUp && isOver(show)

/** More is being made: TMDB says it's in production, it's planned, or a new season is listed. */
export function isInProduction(show: Show) {
  if (isOver(show)) return false
  if (show.in_production || show.status === 'In Production' || show.status === 'Planned' || show.status === 'Pilot') return true
  return !!show.latest_season && !!show.last_aired_season && show.latest_season > show.last_aired_season
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
