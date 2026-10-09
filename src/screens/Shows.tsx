import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Episode, type Show } from '../db'
import { episodeLabel, formatShortDate, startOfDay } from '../lib/dates'
import { isOngoing } from '../lib/tmdb'
import { navigate } from '../lib/router'
import { useNow } from '../hooks/useNow'
import { Button, EmptyState, ScreenHeader } from '../components/Layout'
import { Poster } from '../components/Poster'
import { PlusIcon } from '../components/Icons'

/** Every show you follow, A–Z, including ended ones that never appear on Upcoming. */
export function Shows() {
  const now = useNow()
  const todayIso = startOfDay(now).toISOString()

  const data = useLiveQuery(async () => {
    const shows = (await db.shows.toArray()).filter((s) => s.followed).sort((a, b) => a.name.localeCompare(b.name))
    const next = new Map<number, Episode>()
    for (const ep of await db.episodes.where('airstamp').aboveOrEqual(todayIso).sortBy('airstamp')) {
      if (!next.has(ep.tmdb_show_id)) next.set(ep.tmdb_show_id, ep)
    }
    return { shows, next }
  }, [todayIso])

  return (
    <>
      <ScreenHeader
        title="Shows"
        right={
          data?.shows.length ? (
            <button
              onClick={() => navigate('/search', { replace: true })}
              className="rounded-full p-2 text-accent-text"
              aria-label="Add a show"
            >
              <PlusIcon width={22} height={22} />
            </button>
          ) : null
        }
      />

      {data && data.shows.length === 0 ? (
        <EmptyState
          title="You're not following anything"
          body="Follow shows from Search and they'll all be listed here."
          action={<Button onClick={() => navigate('/search', { replace: true })}>Find a show</Button>}
        />
      ) : (
        <>
          {data && (
            <p className="px-5 pb-1 text-xs text-neutral-500 dark:text-neutral-400">
              {data.shows.length} {data.shows.length === 1 ? 'show' : 'shows'}
            </p>
          )}
          <ul className="pb-6">
            {data?.shows.map((show) => (
              <li key={show.tmdb_id}>
                <button
                  onClick={() => navigate(`/show/${show.tmdb_id}`)}
                  className="flex w-full items-center gap-4 px-5 py-2.5 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
                >
                  <Poster path={show.poster_path} name={show.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">{show.name}</div>
                    <div className="truncate text-sm text-neutral-500 dark:text-neutral-400">
                      {statusLine(show, data.next.get(show.tmdb_id), now)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function statusLine(show: Show, next: Episode | undefined, now: Date) {
  if (next) return `Next: ${episodeLabel([next])} · ${formatShortDate(next, now)}`
  if (isOngoing(show.status)) return 'Returning, no date yet'
  if (show.status === 'Canceled') return 'Cancelled'
  return show.status || 'No episodes scheduled'
}
