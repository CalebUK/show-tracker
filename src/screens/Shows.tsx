import { useState } from 'react'
import type { Episode, Show } from '../db'
import { episodeLabel, formatDuration, formatShortDate } from '../lib/dates'
import { isFinished, nextSeasonNote, type Progress } from '../lib/progress'
import { navigate } from '../lib/router'
import { canStream, myServicesStore, whereToWatch } from '../lib/services'
import { useLibrary } from '../hooks/useLibrary'
import { useNow } from '../hooks/useNow'
import { Button, Chips, EmptyState, ScreenHeader, Switch } from '../components/Layout'
import { Poster } from '../components/Poster'
import { CloseIcon, PlusIcon, SearchIcon } from '../components/Icons'

type Filter = 'stream' | 'notStarted' | 'finished'

// Kept outside the component so switching tabs doesn't reset the filter or search. null = everything.
let lastFilter: Filter | null = null
let lastQuery = ''

/** Lower case without accents, so "pokemon" finds "Pokémon". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

const HIDE_KEY = 'shows.hideCompleted' // older name, kept so the switch remembers its setting
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

/** Every show you follow, A–Z, with where you're up to. The filters narrow it down. */
export function Shows() {
  const now = useNow()
  const library = useLibrary(now)
  const myServices = myServicesStore.use()
  const [filter, setFilterState] = useState<Filter | null>(lastFilter)
  // Tapping the selected filter again goes back to everything.
  const setFilter = (f: Filter) => setFilterState((lastFilter = f === filter ? null : f))
  const [query, setQueryState] = useState(lastQuery)
  const setQuery = (q: string) => setQueryState((lastQuery = q))
  const [hideDone, setHideState] = useState(loadHide)
  const setHide = (v: boolean) => {
    saveHide(v)
    setHideState(v)
  }

  const progress = (s: Show) => library!.progress.get(s.tmdb_id)!
  const finished = (s: Show) => isFinished(s, progress(s))
  const all = library?.followed ?? []
  const lists = library && {
    // On one of your services (Settings → Streaming services), or owned on DVD or streaming.
    stream: all.filter((s) => canStream(s, myServices)),
    notStarted: all.filter((s) => !s.stopped && !progress(s).started),
    // Shows you're done with: finished, or marked "Stopped watching".
    finished: all.filter((s) => finished(s) || s.stopped),
  }
  const hasAny = all.length > 0
  const filtered = filter ? (lists?.[filter] ?? []) : all
  // Finished: most time spent first (a finished show's whole length, or what you watched before
  // stopping); the rest A–Z.
  const sorted =
    filter === 'finished'
      ? [...filtered].sort((a, b) => (progress(b).minutesWatched ?? -1) - (progress(a).minutesWatched ?? -1) || a.name.localeCompare(b.name))
      : filtered
  const q = fold(query.trim())
  const listed = q ? sorted.filter((s) => fold(s.name).includes(q)) : sorted
  // Done = nothing left to watch (finished, or waiting for more episodes) or stopped watching.
  // It doesn't apply to the Finished filter, which is all done shows.
  const isDone = (s: Show) => progress(s).caughtUp || s.stopped === true
  const canHide = filter !== 'finished'
  const shows = canHide && hideDone ? listed.filter((s) => !isDone(s)) : listed
  const hiddenCount = listed.length - shows.length
  const noMatch = q !== '' && listed.length === 0

  return (
    <>
      <ScreenHeader
        title="Shows"
        right={
          hasAny ? (
            <>
              <label
                className={`mr-1 flex cursor-pointer items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300 ${canHide ? '' : 'opacity-50'}`}
              >
                Hide done
                <Switch checked={hideDone} onChange={setHide} disabled={!canHide} label="Hide done" />
              </label>
              <button
                onClick={() => navigate('/search', { replace: true })}
                className="rounded-full p-2 text-accent-text"
                aria-label="Add a show"
              >
                <PlusIcon width={22} height={22} />
              </button>
            </>
          ) : null
        }
      >
        {hasAny && lists && (
          <>
            <div className="px-5 pb-3">
              <label className="flex h-10 items-center gap-2 rounded-xl bg-neutral-100 px-3 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                <SearchIcon width={16} height={16} />
                <input
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="Search your shows"
                  aria-label="Search your shows"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="h-full min-w-0 flex-1 bg-transparent text-base text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button onClick={() => setQuery('')} aria-label="Clear search" className="p-1">
                    <CloseIcon width={14} height={14} />
                  </button>
                )}
              </label>
            </div>
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
              {hiddenCount > 0 && ` · ${hiddenCount} done hidden`}
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
            {noMatch ? `No shows here match “${query.trim()}”.` : emptyMessage(filter, hiddenCount, myServices.length > 0)}
          </p>
          {filter === 'stream' && !noMatch && hiddenCount === 0 && (
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

function emptyMessage(filter: Filter | null, hidden: number, hasServices: boolean) {
  if (hidden > 0) return "There's nothing left to watch here. Switch off Hide done to see everything."
  if (filter === 'stream') {
    return hasServices
      ? "None of the shows you follow are on your streaming services right now, and you haven't marked any as owned."
      : 'Tick the streaming services you have in Settings, and the shows you follow that are on them will appear here, along with any you own on DVD or streaming.'
  }
  if (filter === 'finished') return "Shows that have ended and you've watched every episode of, and ones you've stopped watching, will appear here."
  return "You've started everything you follow."
}

/** Where you're up to, plus what's next on the schedule (or TMDB's news if nothing is). */
function statusLine(show: Show, p: Progress, nextUp: Episode | undefined, now: Date) {
  if (show.stopped) return stoppedLine(p)
  const scheduled = nextUp && `${episodeLabel([nextUp])} ${formatShortDate(nextUp, now)}`
  if (!p.started) {
    if (p.aired > 0) return `Not started · ${p.aired} episode${p.aired === 1 ? '' : 's'}`
    return scheduled ? `Not started · starts ${scheduled}` : `Not started · ${nextSeasonNote(show)}`
  }
  if (p.next) return `Up next: ${episodeLabel([p.next])} · ${p.left} left`
  return scheduled ? `Caught up · next ${scheduled}` : `Caught up · ${nextSeasonNote(show)}`
}

/** "Stopped watching · 12 of 62 episodes · 9h 30m": how far you got. */
function stoppedLine(p: Progress) {
  if (!p.started) return 'Stopped watching'
  return [
    'Stopped watching',
    `${p.watched} of ${p.aired} episode${p.aired === 1 ? '' : 's'}`,
    p.minutesWatched != null ? formatDuration(p.minutesWatched) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** "Ended · 73 episodes · 2d 21h": how long the whole show was, from its episode runtimes. */
function finishedLine(show: Show, p: Progress) {
  return [
    show.status === 'Canceled' ? 'Cancelled' : 'Ended',
    `${p.aired} episode${p.aired === 1 ? '' : 's'}`,
    p.minutesWatched != null ? formatDuration(p.minutesWatched) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
