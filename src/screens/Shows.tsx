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

type Filter = 'following' | 'stream' | 'notStarted' | 'finished'

// Kept outside the component so switching tabs doesn't reset the filter.
let lastFilter: Filter = 'following'

const HIDE_KEY = 'shows.hideCaughtUp'
function loadHide() {
  try {
    return localStorage.getItem(HIDE_KEY) === '1'
  } catch {
    return false
  }
}
function saveHide(value: boolean) {
  try {
    localStorage.setItem(HIDE_KEY, value ? '1' : '0')
  } catch {
    // Private mode or blocked storage: the setting just won't stick.
  }
}

/** Every show you follow (or own), A–Z, with where you're up to. */
export function Shows() {
  const now = useNow()
  const library = useLibrary(now)
  const myServices = myServicesStore.use()
  const [filter, setFilterState] = useState<Filter>(lastFilter)
  const setFilter = (f: Filter) => setFilterState((lastFilter = f))
  const [hideCaughtUp, setHideState] = useState(loadHide)
  const setHide = (v: boolean) => {
    saveHide(v)
    setHideState(v)
  }

  const progress = (s: Show) => library!.progress.get(s.tmdb_id)!
  const finished = (s: Show) => isFinished(s, progress(s))
  const following = library?.followed.filter((s) => !finished(s)) ?? []
  const lists = library && {
    // Finished shows (ended and fully watched) move out of the main list into their own.
    following,
    // On one of your services (Settings → Streaming services), or owned on DVD or streaming.
    stream: following.filter((s) => canStream(s, myServices)),
    notStarted: library.followed.filter((s) => !s.stopped && !progress(s).started),
    finished: library.followed.filter(finished),
  }
  const hasAny = (library?.followed.length ?? 0) > 0
  const canHide = filter === 'following' || filter === 'stream'
  const shows = (lists?.[filter] ?? []).filter((s) => !(canHide && hideCaughtUp && progress(s).caughtUp))
  const hiddenCount = (lists?.[filter].length ?? 0) - shows.length

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
            <Chips
              options={[
                { id: 'following', label: 'Following', count: lists.following.length },
                { id: 'stream', label: 'Able to stream', count: lists.stream.length },
                { id: 'notStarted', label: 'Not started', count: lists.notStarted.length },
                { id: 'finished', label: 'Finished', count: lists.finished.length },
              ]}
              value={filter}
              onChange={setFilter}
            />
            {canHide && (
              <label className="flex cursor-pointer items-center gap-2 px-5 pb-3 text-sm text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={hideCaughtUp}
                  onChange={(e) => setHide(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-accent"
                />
                Hide caught up
                {hideCaughtUp && hiddenCount > 0 && <span className="text-neutral-400">({hiddenCount} hidden)</span>}
              </label>
            )}
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
            {filter === 'stream' && hiddenCount === 0
              ? myServices.length === 0
                ? 'Tick the streaming services you have in Settings, and the shows you follow that are on them will appear here, along with any you own on DVD or streaming.'
                : "None of the shows you follow are on your streaming services right now, and you haven't marked any as owned."
              : emptyMessage(filter, hiddenCount, lists.finished.length)}
          </p>
          {filter === 'stream' && hiddenCount === 0 && (
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
                    {filter === 'finished'
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

function emptyMessage(filter: Filter, hidden: number, finishedCount: number) {
  if (hidden > 0) return "You're caught up on everything here. Untick Hide caught up to see them."
  if (filter === 'finished') return "Shows that have ended and you've watched every episode of will move here."
  if (filter === 'notStarted') return "You've started everything you follow."
  if (finishedCount > 0) return "You've finished everything you follow. They're under Finished."
  return "You're not following anything. Follow shows from Search to see them here."
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
