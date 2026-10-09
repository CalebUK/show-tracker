import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Show } from '../db'
import { episodeLabel, formatAirTime, groupUpcoming, type UpcomingGroups, type UpcomingRow } from '../lib/dates'
import { isFinished, nextSeasonNote, type Progress } from '../lib/progress'
import { refreshFollowed, refreshStore } from '../lib/shows'
import { setWatched } from '../lib/watched'
import { getTmdbKey } from '../lib/tmdb'
import { navigate } from '../lib/router'
import { errorMessage, toast } from '../lib/toast'
import { useLibrary } from '../hooks/useLibrary'
import { useNow } from '../hooks/useNow'
import { useOnline } from '../hooks/useOnline'
import { Button, Chips, EmptyState, ScreenHeader } from '../components/Layout'
import { PullToRefresh } from '../components/PullToRefresh'
import { Poster } from '../components/Poster'
import { CheckIcon, RefreshIcon, Spinner } from '../components/Icons'

const SECTIONS: { id: keyof UpcomingGroups; title: string }[] = [
  { id: 'today', title: 'Today' },
  { id: 'week', title: 'This week' },
  { id: 'later', title: 'Later' },
]

type View = 'on' | 'off'
const VIEWS: { id: View; label: string }[] = [
  { id: 'on', label: 'On air' },
  { id: 'off', label: 'Off air' },
]

// Kept outside the component so switching tabs doesn't reset it.
let lastView: View = 'on'

export function Upcoming() {
  const now = useNow()
  const online = useOnline()
  const refresh = refreshStore.use()
  const library = useLibrary(now)
  const [view, setViewState] = useState<View>(lastView)
  const setView = (v: View) => setViewState((lastView = v))

  const data = useMemo(() => {
    if (!library) return null
    const { followed, upcoming, scheduled, progress } = library
    const p = (s: Show) => progress.get(s.tmdb_id)!
    // Finished shows (ended and fully watched) are done; they live under Shows → Finished instead.
    const unscheduled = followed.filter((s) => !scheduled.has(s.tmdb_id))
    const offAir = unscheduled.filter((s) => !isFinished(s, p(s)))
    return {
      groups: groupUpcoming(upcoming, new Map(followed.map((s) => [s.tmdb_id, s])), now),
      upNext: offAir
        .filter((s) => p(s).started && !p(s).caughtUp)
        .sort((a, b) => (p(b).lastWatchedAt ?? '').localeCompare(p(a).lastWatchedAt ?? '')),
      notStarted: offAir.filter((s) => !p(s).started),
      caughtUp: offAir.filter((s) => p(s).caughtUp),
      offAirCount: offAir.length,
      finishedCount: unscheduled.length - offAir.length,
    }
  }, [library, now])

  const forceRefresh = useCallback(async () => {
    if (!navigator.onLine) {
      toast("You're offline. Showing saved episodes.")
      return
    }
    if (!getTmdbKey()) {
      toast('Add your TMDB key in Settings to refresh.')
      return
    }
    await refreshFollowed({ force: true })
    const { error } = refreshStore.get()
    if (error) toast(`Couldn't refresh everything: ${error}`)
  }, [])

  const hasShows = (library?.followed.length ?? 0) > 0
  const { groups } = data ?? {}
  const nothingScheduled = groups && !groups.today.length && !groups.week.length && !groups.later.length

  return (
    <>
      <ScreenHeader
        title="Upcoming"
        right={
          hasShows ? (
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
        {hasShows && <Chips options={VIEWS} value={view} onChange={setView} />}
        {!online && (
          <p className="px-5 pb-2 text-xs text-neutral-500 dark:text-neutral-400">Offline · showing saved episodes</p>
        )}
      </ScreenHeader>

      <PullToRefresh onRefresh={forceRefresh}>
        {library && !hasShows ? (
          <EmptyState
            title="Nothing to track yet"
            body="Search for a show and follow it to see its next episodes here."
            action={<Button onClick={() => navigate('/search', { replace: true })}>Find a show</Button>}
          />
        ) : !data ? null : view === 'on' ? (
          <div className="pb-6">
            {SECTIONS.map(({ id, title }) =>
              data.groups[id].length ? (
                <Section key={id} title={title}>
                  {data.groups[id].map((row) => (
                    <EpisodeRow key={row.key} row={row} group={id} now={now} progress={library!.progress.get(row.show.tmdb_id)} />
                  ))}
                </Section>
              ) : null,
            )}
            {nothingScheduled && (
              <Notice>
                Nothing scheduled for the shows you follow.
                {data.offAirCount > 0 && ' Off air has your next episodes to watch.'}
              </Notice>
            )}
          </div>
        ) : (
          <div className="pb-6">
            {data.upNext.length > 0 && (
              <Section title="Up next">
                {data.upNext.map((show) => (
                  <UpNextRow key={show.tmdb_id} show={show} progress={library!.progress.get(show.tmdb_id)!} />
                ))}
              </Section>
            )}
            {data.notStarted.length > 0 && (
              <Section title="Not started">
                {data.notStarted.map((show) => (
                  <UpNextRow key={show.tmdb_id} show={show} progress={library!.progress.get(show.tmdb_id)!} />
                ))}
              </Section>
            )}
            {data.caughtUp.length > 0 && (
              <Section title="Caught up">
                {data.caughtUp.map((show) => (
                  <li key={show.tmdb_id}>
                    <button
                      onClick={() => navigate(`/show/${show.tmdb_id}`)}
                      className="flex w-full items-center gap-4 px-5 py-2 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
                    >
                      <Poster path={show.poster_path} name={show.name} size="xs" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] text-neutral-700 dark:text-neutral-200">{show.name}</div>
                        <div className="truncate text-sm text-neutral-500 dark:text-neutral-400">{nextSeasonNote(show)}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </Section>
            )}
            {data.offAirCount === 0 && (
              <Notice>
                {data.finishedCount > 0
                  ? "Nothing to catch up on. Shows you've finished are in the Shows tab under Finished."
                  : 'Every show you follow has episodes on the schedule. Shows with nothing scheduled appear here with your next unwatched episode.'}
              </Notice>
            )}
          </div>
        )}
      </PullToRefresh>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="px-5 pb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{title}</h2>
      <ul>{children}</ul>
    </section>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="px-5 pt-8 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{children}</p>
}

function EpisodeRow({ row, group, now, progress }: { row: UpcomingRow; group: keyof UpcomingGroups; now: Date; progress?: Progress }) {
  const ep = row.episodes[0]
  const aired = group === 'today' && ep.has_time && new Date(ep.airstamp) < now
  const title = row.episodes.length > 1 ? `${row.episodes.length} episodes` : ep.name
  // Only nudge about a backlog once you've started the show.
  const behind = progress?.started ? progress.left : 0
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
          {behind > 0 && <div className="text-xs font-medium text-accent-text">{behind} to catch up</div>}
        </div>
        <div className={`shrink-0 text-right text-sm tabular-nums ${aired ? 'text-neutral-400' : 'text-neutral-700 dark:text-neutral-200'}`}>
          {aired ? 'Aired' : formatAirTime(ep, group)}
        </div>
      </button>
    </li>
  )
}

/** A show with nothing scheduled: your next unwatched episode, with a tick to mark it and move on. */
function UpNextRow({ show, progress }: { show: Show; progress: Progress }) {
  const ep = progress.next
  const [busy, setBusy] = useState(false)

  const tick = async () => {
    if (!ep) return
    setBusy(true)
    try {
      await setWatched([ep], true)
      toast(`Watched ${episodeLabel([ep])} of ${show.name}`)
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex items-center gap-2 pr-4">
      <button
        onClick={() => navigate(`/show/${show.tmdb_id}`)}
        className="flex min-w-0 flex-1 items-center gap-4 py-2.5 pl-5 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
      >
        <Poster path={show.poster_path} name={show.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{show.name}</div>
          <div className="truncate text-sm text-neutral-500 dark:text-neutral-400">
            {ep ? (
              <>
                <span className="tabular-nums">{episodeLabel([ep])}</span>
                {ep.name ? ` · ${ep.name}` : ''}
              </>
            ) : (
              'No episode list yet'
            )}
          </div>
          {ep && progress.started && <div className="text-xs text-neutral-400">{progress.left} left</div>}
        </div>
      </button>
      {ep && (
        <button
          onClick={tick}
          disabled={busy}
          aria-label={`Mark ${episodeLabel([ep])} as watched`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-neutral-200 text-neutral-400 transition active:border-accent active:bg-accent active:text-white dark:border-neutral-700"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <CheckIcon width={20} height={20} />}
        </button>
      )}
    </li>
  )
}
