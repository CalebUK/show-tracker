import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, isOwned, type Episode, type Show } from '../db'
import { episodeLabel, formatShortDate, startOfDay } from '../lib/dates'
import { isOngoing } from '../lib/tmdb'
import { navigate } from '../lib/router'
import { useNow } from '../hooks/useNow'
import { Button, EmptyState, ScreenHeader } from '../components/Layout'
import { Poster } from '../components/Poster'
import { PlusIcon } from '../components/Icons'

type Filter = 'following' | 'owned'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'following', label: 'Following' },
  { id: 'owned', label: 'Owned' },
]

// Kept outside the component so switching tabs doesn't reset the filter.
let lastFilter: Filter = 'following'

/** Every show you follow (or own), A–Z, including ended ones that never appear on Upcoming. */
export function Shows() {
  const now = useNow()
  const todayIso = startOfDay(now).toISOString()
  const [filter, setFilterState] = useState<Filter>(lastFilter)
  const setFilter = (f: Filter) => setFilterState((lastFilter = f))

  const data = useLiveQuery(async () => {
    const all = (await db.shows.toArray()).sort((a, b) => a.name.localeCompare(b.name))
    const next = new Map<number, Episode>()
    for (const ep of await db.episodes.where('airstamp').aboveOrEqual(todayIso).sortBy('airstamp')) {
      if (!next.has(ep.tmdb_show_id)) next.set(ep.tmdb_show_id, ep)
    }
    return { following: all.filter((s) => s.followed), owned: all.filter(isOwned), next }
  }, [todayIso])

  const hasAny = data && (data.following.length > 0 || data.owned.length > 0)
  const shows = data?.[filter] ?? []

  return (
    <>
      <ScreenHeader
        title="Shows"
        right={
          hasAny ? (
            <button
              onClick={() => navigate('/search', { replace: true })}
              className="rounded-full p-2 text-accent-text"
              aria-label="Add a show"
            >
              <PlusIcon width={22} height={22} />
            </button>
          ) : null
        }
      >
        {hasAny && (
          <div className="flex gap-2 px-5 pb-3">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`h-8 shrink-0 rounded-full px-3.5 text-sm font-medium transition ${
                  filter === f.id
                    ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                    : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                }`}
              >
                {f.label} {data[f.id].length > 0 && <span className="opacity-60">{data[f.id].length}</span>}
              </button>
            ))}
          </div>
        )}
      </ScreenHeader>

      {data && !hasAny ? (
        <EmptyState
          title="You're not following anything"
          body="Follow shows from Search and they'll all be listed here."
          action={<Button onClick={() => navigate('/search', { replace: true })}>Find a show</Button>}
        />
      ) : data && shows.length === 0 ? (
        <p className="px-5 pt-8 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          {filter === 'owned'
            ? "Nothing marked as owned yet. Open a show and tick Own on DVD or Own on streaming."
            : "You're not following anything. Follow shows from Search to see them here."}
        </p>
      ) : (
        <ul className="pb-6">
          {shows.map((show) => (
            <li key={show.tmdb_id}>
              <button
                onClick={() => navigate(`/show/${show.tmdb_id}`)}
                className="flex w-full items-center gap-4 px-5 py-2.5 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
              >
                <Poster path={show.poster_path} name={show.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{show.name}</div>
                  <div className="truncate text-sm text-neutral-500 dark:text-neutral-400">
                    {filter === 'owned' ? ownedLine(show) : statusLine(show, data?.next.get(show.tmdb_id), now)}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
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

function ownedLine(show: Show) {
  return [show.own_dvd && 'On DVD', show.own_streaming && 'On streaming'].filter(Boolean).join(' · ')
}
