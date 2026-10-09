import { useCallback, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Show } from '../db'
import { episodeLabel, formatAirTime, groupUpcoming, startOfDay, type UpcomingGroups, type UpcomingRow } from '../lib/dates'
import { refreshFollowed, refreshStore } from '../lib/shows'
import { isOngoing } from '../lib/tmdb'
import { navigate } from '../lib/router'
import { toast } from '../lib/toast'
import { useNow } from '../hooks/useNow'
import { useOnline } from '../hooks/useOnline'
import { Button, EmptyState, ScreenHeader } from '../components/Layout'
import { PullToRefresh } from '../components/PullToRefresh'
import { Poster } from '../components/Poster'
import { RefreshIcon, Spinner } from '../components/Icons'

const SECTIONS: { id: keyof UpcomingGroups; title: string }[] = [
  { id: 'today', title: 'Today' },
  { id: 'week', title: 'This week' },
  { id: 'later', title: 'Later' },
]

export function Upcoming() {
  const now = useNow()
  const online = useOnline()
  const refresh = refreshStore.use()
  const todayIso = startOfDay(now).toISOString()

  const data = useLiveQuery(async () => {
    const shows = (await db.shows.toArray()).filter((s) => s.followed)
    const episodes = await db.episodes.where('airstamp').aboveOrEqual(todayIso).sortBy('airstamp')
    return { shows, episodes }
  }, [todayIso])

  const { groups, noDate } = useMemo(() => {
    if (!data) return { groups: null, noDate: [] as Show[] }
    const byId = new Map(data.shows.map((s) => [s.tmdb_id, s]))
    // Anything from today onward counts as scheduled, so a show listed under Today isn't repeated below.
    const scheduled = new Set(data.episodes.map((e) => e.tmdb_show_id))
    return {
      groups: groupUpcoming(data.episodes, byId, now),
      noDate: data.shows.filter((s) => !scheduled.has(s.tmdb_id) && isOngoing(s.status)).sort((a, b) => a.name.localeCompare(b.name)),
    }
  }, [data, now])

  const forceRefresh = useCallback(async () => {
    if (!navigator.onLine) {
      toast("You're offline. Showing saved episodes.")
      return
    }
    await refreshFollowed({ force: true })
    const { error } = refreshStore.get()
    if (error) toast(`Couldn't refresh everything: ${error}`)
  }, [])

  const isEmpty = data && data.shows.length === 0
  const nothingScheduled = groups && !groups.today.length && !groups.week.length && !groups.later.length

  return (
    <>
      <ScreenHeader
        title="Upcoming"
        right={
          data?.shows.length ? (
            <button
              onClick={forceRefresh}
              disabled={refresh.running}
              className="rounded-full p-2 text-neutral-400 active:text-neutral-600"
              aria-label="Refresh"
            >
              {refresh.running ? <Spinner /> : <RefreshIcon width={20} height={20} />}
            </button>
          ) : null
        }
      >
        {!online && (
          <p className="px-5 pb-2 text-xs text-neutral-500 dark:text-neutral-400">Offline · showing saved episodes</p>
        )}
      </ScreenHeader>

      <PullToRefresh onRefresh={forceRefresh}>
        {isEmpty ? (
          <EmptyState
            title="Nothing to track yet"
            body="Search for a show and follow it to see its next episodes here."
            action={<Button onClick={() => navigate('/search', { replace: true })}>Find a show</Button>}
          />
        ) : (
          <div className="pb-6">
            {groups &&
              SECTIONS.map(({ id, title }) =>
                groups[id].length ? (
                  <section key={id} className="mt-4">
                    <h2 className="px-5 pb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                      {title}
                    </h2>
                    <ul>
                      {groups[id].map((row) => (
                        <EpisodeRow key={row.key} row={row} group={id} now={now} />
                      ))}
                    </ul>
                  </section>
                ) : null,
              )}

            {nothingScheduled && (
              <p className="px-5 pt-8 text-sm text-neutral-500 dark:text-neutral-400">No episodes scheduled for the shows you follow.</p>
            )}

            {noDate.length > 0 && (
              <section className="mt-10">
                <h2 className="px-5 pb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  Returning, no date yet
                </h2>
                <ul>
                  {noDate.map((show) => (
                    <li key={show.tmdb_id}>
                      <button
                        onClick={() => navigate(`/show/${show.tmdb_id}`)}
                        className="flex w-full items-center gap-3 px-5 py-2 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
                      >
                        <Poster path={show.poster_path} name={show.name} size="xs" />
                        <span className="truncate text-[15px] text-neutral-600 dark:text-neutral-300">{show.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </PullToRefresh>
    </>
  )
}

function EpisodeRow({ row, group, now }: { row: UpcomingRow; group: keyof UpcomingGroups; now: Date }) {
  const ep = row.episodes[0]
  const aired = group === 'today' && ep.has_time && new Date(ep.airstamp) < now
  const title = row.episodes.length > 1 ? `${row.episodes.length} episodes` : ep.name
  return (
    <li>
      <button
        onClick={() => navigate(`/show/${row.show.tmdb_id}`)}
        className="flex w-full items-center gap-4 px-5 py-2.5 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
      >
        <Poster path={row.show.poster_path} name={row.show.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{row.show.name}</div>
          <div className="truncate text-sm text-neutral-500 dark:text-neutral-400">
            <span className="tabular-nums">{episodeLabel(row.episodes)}</span>
            {title ? ` · ${title}` : ''}
          </div>
        </div>
        <div className={`shrink-0 text-right text-sm tabular-nums ${aired ? 'text-neutral-400' : 'text-neutral-700 dark:text-neutral-200'}`}>
          {aired ? 'Aired' : formatAirTime(ep, group)}
        </div>
      </button>
    </li>
  )
}
