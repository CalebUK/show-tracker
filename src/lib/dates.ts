import type { Episode, Show } from '../db'

const DAY_MS = 24 * 60 * 60 * 1000

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** A row in the Upcoming list. Episodes of one show released together (a binge drop) share a row. */
export interface UpcomingRow {
  key: string
  show: Show
  episodes: Episode[]
  airstamp: string
}

export interface UpcomingGroups {
  today: UpcomingRow[]
  week: UpcomingRow[]
  later: UpcomingRow[]
}

/**
 * Today = anything airing on the current local calendar day (including earlier today).
 * This week = the next six days. Later = only each show's next episode, to keep it short.
 * `episodes` must be sorted by airstamp.
 */
export function groupUpcoming(episodes: Episode[], shows: Map<number, Show>, now = new Date()): UpcomingGroups {
  const today = startOfDay(now).getTime()
  const tomorrow = today + DAY_MS
  const weekEnd = today + 7 * DAY_MS

  const rows: UpcomingRow[] = []
  const drops = new Map<string, UpcomingRow>()
  for (const ep of episodes) {
    const show = shows.get(ep.tmdb_show_id)
    if (!show) continue
    const dropKey = `${show.tmdb_id}@${ep.airstamp}`
    const sameDrop = drops.get(dropKey)
    if (sameDrop) {
      sameDrop.episodes.push(ep)
      continue
    }
    const row = { key: `${show.tmdb_id}-${ep.id}`, show, episodes: [ep], airstamp: ep.airstamp }
    drops.set(dropKey, row)
    rows.push(row)
  }
  for (const row of rows) row.episodes.sort((a, b) => a.season - b.season || (a.number ?? 0) - (b.number ?? 0))

  const groups: UpcomingGroups = { today: [], week: [], later: [] }
  const seenLater = new Set<number>()
  const seenSoon = new Set<number>()
  for (const row of rows) {
    const t = Date.parse(row.airstamp)
    if (t < today) continue
    if (t < tomorrow) {
      groups.today.push(row)
      seenSoon.add(row.show.tmdb_id)
    } else if (t < weekEnd) {
      groups.week.push(row)
      seenSoon.add(row.show.tmdb_id)
    } else if (!seenSoon.has(row.show.tmdb_id) && !seenLater.has(row.show.tmdb_id)) {
      groups.later.push(row)
      seenLater.add(row.show.tmdb_id)
    }
  }
  return groups
}

export function episodeLabel(episodes: Pick<Episode, 'season' | 'number'>[]) {
  const first = episodes[0]
  const last = episodes[episodes.length - 1]
  if (first.number == null) return `S${first.season} Special`
  if (episodes.length === 1 || last.number == null) return `S${first.season} E${first.number}`
  return `S${first.season} E${first.number}–${last.number}`
}

const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const monthDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const fullDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** Air time in the device's time zone, worded for the group it sits in. */
export function formatAirTime(ep: Pick<Episode, 'airstamp' | 'has_time'>, group: keyof UpcomingGroups | 'detail') {
  const d = new Date(ep.airstamp)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  switch (group) {
    case 'today':
      return ep.has_time ? time.format(d) : 'Today'
    case 'week':
      return ep.has_time ? `${weekday.format(d)} ${time.format(d)}` : weekday.format(d)
    case 'later':
      return sameYear ? monthDay.format(d) : fullDate.format(d)
    case 'detail': {
      const day = sameYear ? monthDay.format(d) : fullDate.format(d)
      return ep.has_time ? `${day}, ${time.format(d)}` : day
    }
  }
}

/** For TMDB's date-only next-episode field ("2026-10-21"). */
export function formatDateOnly(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === new Date().getFullYear() ? monthDay.format(date) : fullDate.format(date)
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function timeAgo(iso: string) {
  const days = Math.round((Date.parse(iso) - Date.now()) / DAY_MS)
  if (days === 0) return 'today'
  return rtf.format(days, 'day')
}
