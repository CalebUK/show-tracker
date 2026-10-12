import { useState } from 'react'
import type { Episode, Show } from '../db'
import { episodeLabel, formatShortDate } from '../lib/dates'
import { isFinished, nextSeasonNote, type Progress } from '../lib/progress'
import { navigate } from '../lib/router'
import { canStream, myServicesStore, whereToWatch } from '../lib/services'
import { useLibrary } from '../hooks/useLibrary'
import { useNow } from '../hooks/useNow'
import { Button, Chips, EmptyState, ScreenHeader } from '../components/Layout'
import { Poster } from '../components/Poster'
import { PlusIcon } from '../components/Icons'

type Filter = 'stream' | 'notStarted' | 'finished'

// Kept outside the component so switching tabs doesn't reset the filter. null = everything.
let lastFilter: Filter | null = null

/** Every show you follow, A–Z, with where you're up to. The filters narrow it down. */
export function Shows() {
  const now = useNow()
  const library = useLibrary(now)
  const myServices = myServicesStore.use()
  const [filter, setFilterState] = useState<Filter | null>(lastFilter)
  // Tapping the selected filter again goes back to everything.
  const setFilter = (f: Filter) => setFilterState((lastFilter = f === filter ? null : f))

  const progress = (s: Show) => library!.progress.get(s.tmdb_id)!
  const finished = (s: Show) => isFinished(s, progress(s))
  const all = library?.followed ?? []
  const lists = library && {
    // On one of your services (Settings → Streaming services), or owned on DVD or streaming.
    stream: all.filter((s) => canStream(s, myServices)),
    notStarted: all.filter((s) => !s.stopped && !progress(s).started),
    finished: all.filter(finished),
  }
  const hasAny = all.length > 0
  const shows = filter ? (lists?.[filter] ?? []) : all

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
        {hasAny && lists && (
          <>
            {/* No counts on the chips so all three fit on one line; the count sits on the row below. */}
            <Chips
              options={[
                { id: 'stream', label: 'Able to stream' },
                { id: 'notStarted', label: 'Not started' },
                { id: 'finished', label: 'Finished' },
              ]}
              value={filter}
              onChange={setFilter}
            />
            <p className="px-5 pb-3 text-sm text-neutral-400 tabular-nums">
              {shows.length} show{shows.length === 1 ? '' : 's'}
            </p>
          </>
        )}
      </ScreenHeader>

      {lists && !hasAny ? (
        <EmptyState
          title="You're not following anything"
          body="Follow shows from Search and they'll all be listed here."
          action={<Button onClick={() => navigate('/search', { replace: true })}>Find a show</Button>}
        />
      ) : lists && shows.length === 0 ? (
        <div className="px-5 pt-8">
          <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
            {filter === 'stream'
              ? myServices.length === 0
                ? 'Tick the streaming services you have in Settings, and the shows you follow that are on them will appear here, along with any you own on DVD or streaming.'
                : "None of the shows you follow are on your streaming services right now, and you haven't marked any as owned."
              : filter === 'finished'
                ? "Shows that have ended and you've watched every episode of will appear here."
                : "You've started everything you follow."}
          </p>
          {filter === 'stream' && (
            <Button variant="secondary" className="mt-4" onClick={() => navigate('/settings', { replace: true })}>
              Choose your services
            </Button>
          )}
        </div>
      ) : (
        <ul className="pb-6">
          {filter === 'stream' && myServices.length === 0 && (
            <li className="px-5 pb-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
              These are the shows you own. Tick your streaming services in{' '}
              <button onClick={() => navigate('/settings', { replace: true })} className="text-accent-text">
                Settings
              </button>{' '}
              to add the shows on them.
            </li>
          )}
          {shows.map((show) => (
            <li key={show.tmdb_id}>
              <button
                onClick={() => navigate(`/show/${show.tmdb_id}`)}
                className="flex w-full items-center gap-4 px-5 py-2.5 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
              >
                <Poster path={show.poster_path} name={show.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[15px] leading-snug font-medium [overflow-wrap:anywhere]">{show.name}</div>
                  <div className="truncate text-sm text-neutral-500 dark:text-neutral-400">
                    {finished(show)
                      ? finishedLine(show, progress(show))
                      : statusLine(show, progress(show), library!.nextUp.get(show.tmdb_id), now)}
                  </div>
                  {filter === 'stream' && <div className="truncate text-xs text-accent-text">{whereToWatch(show, myServices)}</div>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** Where you're up to, plus what's next on the schedule (or TMDB's news if nothing is). */
function statusLine(show: Show, p: Progress, nextUp: Episode | undefined, now: Date) {
  if (show.stopped) return 'Stopped watching'
  const scheduled = nextUp && `${episodeLabel([nextUp])} ${formatShortDate(nextUp, now)}`
  if (!p.started) {
    if (p.aired > 0) return `Not started · ${p.aired} episode${p.aired === 1 ? '' : 's'}`
    return scheduled ? `Not started · starts ${scheduled}` : `Not started · ${nextSeasonNote(show)}`
  }
  if (p.next) return `Up next: ${episodeLabel([p.next])} · ${p.left} left`
  return scheduled ? `Caught up · next ${scheduled}` : `Caught up · ${nextSeasonNote(show)}`
}

function finishedLine(show: Show, p: Progress) {
  return `${show.status === 'Canceled' ? 'Cancelled' : 'Ended'} · watched all ${p.aired} episode${p.aired === 1 ? '' : 's'}`
}
