import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Episode, Show } from '../db'
import { addMonths, episodeLabel, formatAirTime, groupUpcoming, startOfDay, type UpcomingGroups, type UpcomingRow } from '../lib/dates'
import { isAired, isFinished, isInProduction, nextSeasonNote, type Progress } from '../lib/progress'
import { refreshFollowed, refreshStore } from '../lib/shows'
import { setWatched } from '../lib/watched'
import { getTmdbKey } from '../lib/tmdb'
import { navigate } from '../lib/router'
import { errorMessage, toast } from '../lib/toast'
import { isWatched, useLibrary } from '../hooks/useLibrary'
import { useNow } from '../hooks/useNow'
import { useOnline } from '../hooks/useOnline'
import { Button, Chips, EmptyState, ScreenHeader } from '../components/Layout'
import { PullToRefresh } from '../components/PullToRefresh'
import { Poster } from '../components/Poster'
import { CheckIcon, ChevronIcon, RefreshIcon, Spinner } from '../components/Icons'

const SECTIONS: { id: keyof UpcomingGroups; title: string }[] = [
  { id: 'today', title: 'Today' },
  { id: 'week', title: 'This week' },
  { id: 'later', title: 'Later' },
]

type View = 'on' | 'streaming'
const VIEWS: { id: View; label: string }[] = [
  { id: 'on', label: 'On air' },
  { id: 'streaming', label: 'Streaming' },
]

/** Further out than this, a show's next date goes in the "More than 3 months away" section. */
const SOON_MONTHS = 3

// Kept outside the component so switching tabs doesn't reset it.
let lastView: View = 'on'

export function Watching() {
  const now = useNow()
  const online = useOnline()
  const refresh = refreshStore.use()
  const library = useLibrary(now)
  const [view, setViewState] = useState<View>(lastView)
  const setView = (v: View) => setViewState((lastView = v))

  const data = useMemo(() => {
    if (!library) return null
    const { upcoming, progress } = library
    // Shows marked "Stopped watching" stay followed but never appear here.
    const followed = library.followed.filter((s) => !s.stopped)
    const p = (s: Show) => progress.get(s.tmdb_id)!
    const todayIso = startOfDay(now).toISOString()
    const soonIso = addMonths(startOfDay(now), SOON_MONTHS).toISOString()

    // Episodes you've ticked drop off the schedule.
    const unwatched = upcoming.filter((e) => !isWatched(library, e))
    const nextDate = new Map<number, Episode>()
    for (const ep of unwatched) if (!nextDate.has(ep.tmdb_show_id)) nextDate.set(ep.tmdb_show_id, ep)

    const soon = unwatched.filter((e) => e.airstamp < soonIso)
    const airingSoon = new Set(soon.map((e) => e.tmdb_show_id))
    const isFarAway = (s: Show) => !airingSoon.has(s.tmdb_id) && nextDate.has(s.tmdb_id)
    const isUndated = (s: Show) => !nextDate.has(s.tmdb_id) && isInProduction(s)

    // Streaming: what you're working through at your own pace, airing or not (e.g. season 1 while
    // season 2 airs). Finished shows live under Shows → Finished instead.
    const active = followed.filter((s) => !isFinished(s, p(s)))
    // An episode that aired today is already listed under On air → Today.
    const nextAiredToday = (s: Show) => !!p(s).next && p(s).next!.airstamp >= todayIso
    // Shows in On air's Save the Date / Still Cooking sections, or on the schedule.
    const hasNews = (s: Show) => isFarAway(s) || isUndated(s)
    const upNext = active
      .filter((s) => p(s).started && p(s).next && !nextAiredToday(s))
      .sort((a, b) => (p(b).lastWatchedAt ?? '').localeCompare(p(a).lastWatchedAt ?? ''))
    const notStarted = active.filter(
      (s) => !p(s).started && (p(s).next ? !nextAiredToday(s) : !airingSoon.has(s.tmdb_id) && !hasNews(s)),
    )
    const caughtUp = active.filter((s) => p(s).caughtUp && !airingSoon.has(s.tmdb_id) && !hasNews(s))

    return {
      // On air: the schedule.
      groups: groupUpcoming(soon, new Map(followed.map((s) => [s.tmdb_id, s])), now),
      farAway: followed.filter(isFarAway).sort((a, b) => nextDate.get(a.tmdb_id)!.airstamp.localeCompare(nextDate.get(b.tmdb_id)!.airstamp)),
      undated: followed.filter(isUndated),
      nextDate,
      // Streaming
      upNext,
      notStarted,
      caughtUp,
      airingSoon,
      streamingCount: upNext.length + notStarted.length + caughtUp.length,
      finishedCount: followed.length - active.length,
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
  const progress = (s: Show) => library!.progress.get(s.tmdb_id)!
  const nothingOnAir = data && !data.groups.today.length && !data.groups.week.length && !data.groups.later.length

  return (
    <>
      <ScreenHeader
        title="Watching"
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
                    <EpisodeRow key={row.key} row={row} group={id} now={now} />
                  ))}
                </Section>
              ) : null,
            )}
            {nothingOnAir && (
              <Notice>
                Nothing in the next {SOON_MONTHS} months for the shows you follow.
                {data.streamingCount > 0 && ' Streaming has your next episodes to watch.'}
              </Notice>
            )}

            <div className="mt-8 space-y-2 px-5">
              {data.farAway.length > 0 && (
                <Collapsible title="Save the Date" subtitle={`More than ${SOON_MONTHS} months away`} count={data.farAway.length}>
                  {data.farAway.map((show) => {
                    const ep = data.nextDate.get(show.tmdb_id)!
                    return (
                      <QuietRow
                        key={show.tmdb_id}
                        show={show}
                        detail={`${episodeLabel([ep])} · ${formatAirTime(ep, 'later')}`}
                        progress={progress(show)}
                      />
                    )
                  })}
                </Collapsible>
              )}
              {data.undated.length > 0 && (
                <Collapsible title="Still Cooking" subtitle="In production, no date yet" count={data.undated.length}>
                  {data.undated.map((show) => (
                    <QuietRow key={show.tmdb_id} show={show} detail={nextSeasonNote(show)} progress={progress(show)} />
                  ))}
                </Collapsible>
              )}
            </div>
          </div>
        ) : (
          <div className="pb-6">
            {data.upNext.length > 0 && (
              <Section title="Up next">
                {data.upNext.map((show) => (
                  <UpNextRow key={show.tmdb_id} show={show} progress={progress(show)} airing={data.airingSoon.has(show.tmdb_id)} />
                ))}
              </Section>
            )}
            {data.notStarted.length > 0 && (
              <Section title="Not started">
                {data.notStarted.map((show) => (
                  <UpNextRow key={show.tmdb_id} show={show} progress={progress(show)} airing={data.airingSoon.has(show.tmdb_id)} />
                ))}
              </Section>
            )}
            {data.caughtUp.length > 0 && (
              <Section title="Caught up">
                {data.caughtUp.map((show) => (
                  <QuietRow key={show.tmdb_id} show={show} detail={nextSeasonNote(show)} padded />
                ))}
              </Section>
            )}
            {data.streamingCount === 0 && (
              <Notice>
                {data.finishedCount > 0
                  ? "Nothing to catch up on. Shows you've finished are in the Shows tab under Finished."
                  : "Nothing to catch up on. Shows you're working through appear here with your next episode to watch."}
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

/** A closed-by-default drop-down for the less urgent groups at the bottom of On air. */
function Collapsible({ title, subtitle, count, children }: { title: string; subtitle: string; count: number; children: ReactNode }) {
  return (
    <details className="group rounded-xl bg-neutral-50 dark:bg-neutral-900">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex-1">
          <span className="block text-[15px] font-medium">{title}</span>
          <span className="block text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</span>
        </span>
        <span className="text-sm text-neutral-500 tabular-nums dark:text-neutral-400">{count}</span>
        <ChevronIcon width={18} height={18} className="text-neutral-400 transition group-open:rotate-90" />
      </summary>
      <ul className="pb-2">{children}</ul>
    </details>
  )
}

/** Small poster, name and one line of detail; taps through to the show. */
function QuietRow({
  show,
  detail,
  progress,
  padded = false,
}: {
  show: Show
  detail: string
  /** When given, adds a line saying how far behind you are. */
  progress?: Progress
  padded?: boolean
}) {
  const behind = progress?.started && progress.left > 0
  const catchUp = progress && catchUpLine(progress)
  return (
    <li className="list-none">
      <button
        onClick={() => navigate(`/show/${show.tmdb_id}`)}
        className={`flex w-full items-center gap-4 py-2 text-left active:bg-neutral-100 dark:active:bg-neutral-800 ${padded ? 'px-5' : 'px-4'}`}
      >
        <Poster path={show.poster_path} name={show.name} size="xs" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] text-neutral-700 dark:text-neutral-200">{show.name}</div>
          <div className="truncate text-sm text-neutral-500 tabular-nums dark:text-neutral-400">{detail}</div>
          {catchUp && (
            <div className={`text-xs tabular-nums ${behind ? 'font-medium text-accent-text' : 'text-neutral-400'}`}>{catchUp}</div>
          )}
        </div>
      </button>
    </li>
  )
}

/** "12 to catch up", "Caught up", or "Not started · 30 episodes". */
function catchUpLine(p: Progress) {
  if (!p.started) return p.aired > 0 ? `Not started · ${p.aired} episode${p.aired === 1 ? '' : 's'}` : null
  return p.left > 0 ? `${p.left} to catch up` : 'Caught up'
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="px-5 pt-8 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{children}</p>
}

/** A scheduled episode (or binge drop). Once it has aired, a tick marks it watched and hides it. */
function EpisodeRow({ row, group, now }: { row: UpcomingRow; group: keyof UpcomingGroups; now: Date }) {
  const ep = row.episodes[0]
  const aired = row.episodes.every((e) => isAired(e, now))
  const title = row.episodes.length > 1 ? `${row.episodes.length} episodes` : ep.name
  return (
    <li className="flex items-center gap-2 pr-4">
      <button
        onClick={() => navigate(`/show/${row.show.tmdb_id}`)}
        className="flex min-w-0 flex-1 items-center gap-4 py-2.5 pl-5 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
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
      {aired && <TickButton episodes={row.episodes} showName={row.show.name} />}
    </li>
  )
}

/** Your next unwatched episode of a show, with a tick to mark it and move on. */
function UpNextRow({ show, progress, airing = false }: { show: Show; progress: Progress; airing?: boolean }) {
  const ep = progress.next
  return (
    <li className="flex items-center gap-2 pr-4">
      <button
        onClick={() => navigate(`/show/${show.tmdb_id}`)}
        className="flex min-w-0 flex-1 items-center gap-4 py-2.5 pl-5 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
      >
        <Poster path={show.poster_path} name={show.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium">{show.name}</span>
            {airing && (
              <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-text dark:bg-accent/20">
                Still airing
              </span>
            )}
          </div>
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
      {ep && <TickButton episodes={[ep]} showName={show.name} />}
    </li>
  )
}

function TickButton({ episodes, showName }: { episodes: Episode[]; showName: string }) {
  const [busy, setBusy] = useState(false)
  const label = episodeLabel(episodes)
  const tick = async () => {
    setBusy(true)
    try {
      await setWatched(episodes, true)
      toast(`Watched ${label} of ${showName}`)
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      onClick={tick}
      disabled={busy}
      aria-label={`Mark ${label} as watched`}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-neutral-200 text-neutral-400 transition active:border-accent active:bg-accent active:text-white dark:border-neutral-700"
    >
      {busy ? <Spinner className="h-4 w-4" /> : <CheckIcon width={20} height={20} />}
    </button>
  )
}
