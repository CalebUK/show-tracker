import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Episode, type Show, type Watched } from '../db'
import { startOfDay } from '../lib/dates'
import { progressFor, type Progress } from '../lib/progress'

export interface Library {
  shows: Show[]
  followed: Show[]
  /** Episodes from the start of today onward, by air time. */
  upcoming: Episode[]
  /** Each show's first episode from the start of today onward. */
  nextUp: Map<number, Episode>
  /** Shows with something on the schedule from today onward ("on air"). */
  scheduled: Set<number>
  progress: Map<number, Progress>
}

/** Everything the Upcoming and Shows screens need, recomputed when the data or the day changes. */
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

    const upcoming = data.episodes.filter((e) => e.airstamp >= todayIso).sort((a, b) => a.airstamp.localeCompare(b.airstamp))
    const nextUp = new Map<number, Episode>()
    for (const ep of upcoming) if (!nextUp.has(ep.tmdb_show_id)) nextUp.set(ep.tmdb_show_id, ep)

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
    }
  }, [data, now])
}
