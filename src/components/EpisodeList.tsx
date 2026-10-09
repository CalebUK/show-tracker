import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, episodeKey, type Episode, type Show } from '../db'
import { formatAirTime } from '../lib/dates'
import { byEpisodeOrder, isAired } from '../lib/progress'
import { clearWatched, setWatched } from '../lib/watched'
import { errorMessage, toast } from '../lib/toast'
import { useNow } from '../hooks/useNow'
import { CheckIcon, ChevronIcon } from './Icons'
import { Switch } from './Layout'

/** Seasons and episodes with tick boxes, for a followed show. */
export function EpisodeList({ show }: { show: Show }) {
  const now = useNow()
  const data = useLiveQuery(async () => {
    const [episodes, watched] = await Promise.all([
      db.episodes.where('tmdb_show_id').equals(show.tmdb_id).toArray(),
      db.watched.where('tmdb_show_id').equals(show.tmdb_id).toArray(),
    ])
    return { episodes: episodes.filter((e) => e.number != null).sort(byEpisodeOrder), watched: new Set(watched.map((w) => w.id)) }
  }, [show.tmdb_id])
  const [openSeasons, setOpenSeasons] = useState<Set<number> | null>(null)
  // After ticking an episode, offer to tick the unwatched ones before it too.
  const [earlier, setEarlier] = useState<Episode[] | null>(null)
  const [beforeAll, setBeforeAll] = useState<Set<string> | null>(null)

  if (!data) return null

  if (data.episodes.length === 0) {
    return (
      <Section title="Episodes">
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          {show.last_refreshed_at ? 'No episode list is available for this show.' : 'The episode list will load on the next refresh.'}
        </p>
      </Section>
    )
  }

  const isWatched = (e: Episode) => data.watched.has(episodeKey(e.tmdb_show_id, e.season, e.number!))
  const aired = data.episodes.filter((e) => isAired(e, now))
  const watchedCount = aired.filter(isWatched).length
  const nextUnwatched = aired.find((e) => !isWatched(e))

  const seasons = new Map<number, Episode[]>()
  for (const ep of data.episodes) seasons.set(ep.season, [...(seasons.get(ep.season) ?? []), ep])
  const defaultOpen = nextUnwatched?.season ?? [...seasons.keys()].at(-1)
  const open = openSeasons ?? new Set(defaultOpen != null ? [defaultOpen] : [])
  const toggleOpen = (season: number) => {
    const next = new Set(open)
    if (next.has(season)) next.delete(season)
    else next.add(season)
    setOpenSeasons(next)
  }

  const run = async (episodes: Episode[], value: boolean) => {
    try {
      await setWatched(episodes, value)
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  const tick = async (ep: Episode, value: boolean) => {
    await run([ep], value)
    const before = value ? aired.filter((e) => byEpisodeOrder(e, ep) < 0 && !isWatched(e)) : []
    setEarlier(before.length ? before : null)
  }

  const allWatched = aired.length > 0 && watchedCount === aired.length
  const toggleAll = async (value: boolean) => {
    setEarlier(null)
    try {
      if (value) {
        // Remember what was ticked, so switching straight back off restores it.
        setBeforeAll(new Set(data.watched))
        await setWatched(aired.filter((e) => !isWatched(e)), true)
      } else if (beforeAll) {
        await clearWatched(show.tmdb_id, beforeAll)
        setBeforeAll(null)
      } else if (window.confirm(`Untick all ${watchedCount} watched episodes of ${show.name}?`)) {
        await clearWatched(show.tmdb_id)
      }
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  return (
    <Section title="Episodes" right={`${watchedCount} of ${aired.length} watched`}>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div className="h-full rounded-full bg-accent" style={{ width: `${aired.length ? (watchedCount / aired.length) * 100 : 0}%` }} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-4 py-1">
        <span className="text-[15px]">Watched all episodes</span>
        <Switch checked={allWatched} onChange={toggleAll} disabled={aired.length === 0} label="Watched all episodes" />
      </div>

      {earlier && (
        <div className="mt-3 rounded-xl bg-neutral-50 p-3 text-sm dark:bg-neutral-900">
          <p>
            Also mark the {earlier.length} earlier episode{earlier.length === 1 ? '' : 's'} as watched?
          </p>
          <div className="mt-2 flex gap-4">
            <button
              className="font-medium text-accent-text"
              onClick={async () => {
                await run(earlier, true)
                setEarlier(null)
              }}
            >
              Mark them
            </button>
            <button className="text-neutral-500 dark:text-neutral-400" onClick={() => setEarlier(null)}>
              Just this one
            </button>
          </div>
        </div>
      )}

      <ul className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
        {[...seasons].map(([season, episodes]) => {
          const seasonAired = episodes.filter((e) => isAired(e, now))
          const seasonWatched = seasonAired.filter(isWatched).length
          const complete = seasonAired.length > 0 && seasonWatched === seasonAired.length
          const isOpen = open.has(season)
          return (
            <li key={season}>
              <button onClick={() => toggleOpen(season)} className="flex w-full items-center gap-3 py-3 text-left" aria-expanded={isOpen}>
                <span className="flex-1 text-[15px] font-medium">Season {season}</span>
                <span className="text-sm text-neutral-500 tabular-nums dark:text-neutral-400">
                  {complete ? <CheckIcon width={18} height={18} className="text-accent-text" /> : `${seasonWatched}/${seasonAired.length || episodes.length}`}
                </span>
                <ChevronIcon width={18} height={18} className={`text-neutral-400 transition ${isOpen ? 'rotate-90' : ''}`} />
              </button>
              {isOpen && (
                <div className="pb-3">
                  {seasonAired.length > 0 && (
                    <button onClick={() => run(seasonAired, !complete)} className="mb-1 text-sm text-accent-text">
                      {complete ? 'Unmark season' : 'Mark season as watched'}
                    </button>
                  )}
                  <ul>
                    {episodes.map((ep) => {
                      const hasAired = isAired(ep, now)
                      return (
                        <li key={ep.id}>
                          <label className={`flex items-center gap-3 py-2 ${hasAired ? 'cursor-pointer' : 'opacity-50'}`}>
                            <span className="w-8 shrink-0 text-sm text-neutral-400 tabular-nums">E{ep.number}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px]">{ep.name || `Episode ${ep.number}`}</span>
                              <span className="block text-xs text-neutral-500 tabular-nums dark:text-neutral-400">
                                {formatAirTime(ep, 'later')}
                              </span>
                            </span>
                            <input
                              type="checkbox"
                              checked={isWatched(ep)}
                              disabled={!hasAired}
                              onChange={(e) => tick(ep, e.target.checked)}
                              aria-label={`Watched season ${ep.season} episode ${ep.number}`}
                              className="h-5 w-5 shrink-0 cursor-pointer accent-accent disabled:cursor-default"
                            />
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </li>
          )
        })}
      </ul>

    </Section>
  )
}

function Section({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{title}</h2>
        {right && <span className="text-sm text-neutral-500 tabular-nums dark:text-neutral-400">{right}</span>}
      </div>
      {children}
    </section>
  )
}
