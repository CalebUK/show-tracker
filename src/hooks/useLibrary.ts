import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, episodeKey, type Episode, type Show, type Watched } from '../db'
import { startOfDay } from '../lib/dates'
import { progressFor, type Progress } from '../lib/progress'

export interface Library {
  shows: Show[]
  followed: Show[]
  /** Episodes from the start of today onward, by air time (including TMDB-only premiere dates). */
  upcoming: Episode[]
  /** Each show's first unwatched episode from the start of today onward. */
  nextUp: Map<number, Episode>
  /** Shows with an unwatched date from today onward. */
  scheduled: Set<number>
  progress: Map<number, Progress>
  /** Ticked episodes, by `episodeKey`. */
  watchedIds: Set<string>
}

/** "2027-07-09" → that day's local midnight as an ISO timestamp. */
function localMidnight(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

/** Everything the Watching and Shows screens need, recomputed when the data or the day changes. */
export function useLibrary(now: Date): Library | undefined {
  const data = useLiveQuery(async () => {
    const [shows, episodes, watched] = await Promise.all([db.shows.toArray(), db.episodes.toArray(), db.watched.toArray()])
    return { shows, episodes, watched }
  }, [])

  return useMemo(() => {
    if (!data) return undefined
    const todayIso = startOfDay(now).toISOString()
    const byShow = new Map<number, Episode[]>()
    for (const ep of data.episodes) {
      const list = byShow.get(ep.tmdb_show_id)
      if (list) list.push(ep)
      else byShow.set(ep.tmdb_show_id, [ep])
    }
    const watchedByShow = new Map<number, Watched[]>()
    for (const w of data.watched) {
      const list = watchedByShow.get(w.tmdb_show_id)
      if (list) list.push(w)
      else watchedByShow.set(w.tmdb_show_id, [w])
    }

    const upcoming = data.episodes.filter((e) => e.airstamp >= todayIso)
    const hasUpcoming = new Set(upcoming.map((e) => e.tmdb_show_id))
    // TMDB often knows a premiere date long before TVmaze lists the episodes (e.g. a season a year
    // out). Treat that date as an upcoming episode so the show sits with the scheduled ones.
    for (const show of data.shows) {
      const next = show.next_air
      if (!show.followed || hasUpcoming.has(show.tmdb_id) || !next?.date) continue
      const airstamp = localMidnight(next.date)
      if (airstamp < todayIso) continue
      upcoming.push({ id: -show.tmdb_id, tmdb_show_id: show.tmdb_id, season: next.season, number: next.number, name: '', airstamp, has_time: false })
    }
    upcoming.sort((a, b) => a.airstamp.localeCompare(b.airstamp))

    // Skip episodes you've already ticked (e.g. one that aired earlier today).
    const watchedIds = new Set(data.watched.map((w) => w.id))
    const nextUp = new Map<number, Episode>()
    for (const ep of upcoming) {
      if (nextUp.has(ep.tmdb_show_id)) continue
      if (ep.number != null && watchedIds.has(episodeKey(ep.tmdb_show_id, ep.season, ep.number))) continue
      nextUp.set(ep.tmdb_show_id, ep)
    }

    const progress = new Map<number, Progress>()
    for (const show of data.shows) {
      progress.set(show.tmdb_id, progressFor(byShow.get(show.tmdb_id) ?? [], watchedByShow.get(show.tmdb_id) ?? [], now))
    }

    const shows = [...data.shows].sort((a, b) => a.name.localeCompare(b.name))
    return {
      shows,
      followed: shows.filter((s) => s.followed),
      upcoming,
      nextUp,
      scheduled: new Set(nextUp.keys()),
      progress,
      watchedIds,
    }
  }, [data, now])
}

export const isWatched = (library: Library, ep: Episode) =>
  ep.number != null && library.watchedIds.has(episodeKey(ep.tmdb_show_id, ep.season, ep.number))
