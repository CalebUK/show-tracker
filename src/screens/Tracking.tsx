import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Episode, Show } from '../db'
import { addMonths, episodeLabel, formatAirTime, formatShortDate, groupUpcoming, startOfDay, type UpcomingGroups, type UpcomingRow } from '../lib/dates'
import { isAired, isFinished, isInProduction, nextSeasonNote, type Progress } from '../lib/progress'
import { refreshFollowed, refreshStore } from '../lib/shows'
import { setWatched } from '../lib/watched'
import { getTmdbKey } from '../lib/tmdb'
import { isOnCurrentSeason, onAirFilterStore } from '../lib/onAir'
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

type View = 'watching' | 'onair'
const VIEWS: { id: View; label: string }[] = [
  { id: 'watching', label: 'Watching' },
  { id: 'onair', label: 'On air' },
]

/** Further out than this, a show's next date goes in the "Save the Date" section. */
const SOON_MONTHS = 3

// Kept outside the component so switching tabs doesn't reset it.
let lastView: View = 'watching'

export function Tracking() {
  const now = useNow()
  const online = useOnline()
  const refresh = refreshStore.use()
  const library = useLibrary(now)
  const onAirFilter = onAirFilterStore.use()
  const [view, setViewState] = useState<View>(lastView)
  const setView = (v: View) => setViewState((lastView = v))

  const data = useMemo(() => {
    if (!library) return null
    const { upcoming, progress } = library
    // Shows marked "Stopped watching" stay followed but never appear here.
    const followed = library.followed.filter((s) => !s.stopped)
    const p = (s: Show) => progress.get(s.tmdb_id)!
    const soonIso = addMonths(startOfDay(now), SOON_MONTHS).toISOString()

    // Episodes you've ticked drop off the schedule.
    const unwatched = upcoming.filter((e) => !isWatched(library, e))
    const nextDate = new Map<number, Episode>()
    for (const ep of unwatched) if (!nextDate.has(ep.tmdb_show_id)) nextDate.set(ep.tmdb_show_id, ep)
    const soon = unwatched.filter((e) => e.airstamp < soonIso)
    const airingSoon = new Set(soon.map((e) => e.tmdb_show_id))

    // Watching: every show you're tracking, by where you're up to, airing or not.
    // Finished shows live under Shows → Finished instead.
    const active = followed.filter((s) => !isFinished(s, p(s)))
    const upNext = active
      .filter((s) => p(s).started && p(s).next)
      .sort((a, b) => (p(b).lastWatchedAt ?? '').localeCompare(p(a).lastWatchedAt ?? ''))
    const notStarted = active.filter((s) => !p(s).started)
    const caughtUp = active.filter((s) => p(s).caughtUp)

    // On air: the schedule. With "Current season", shows you're a season behind on wait until you catch up.
    const onAir = onAirFilter === 'all' ? followed : followed.filter((s) => isOnCurrentSeason(p(s)))
    const onAirIds = new Set(onAir.map((s) => s.tmdb_id))
    const onAirSoon = soon.filter((e) => onAirIds.has(e.tmdb_show_id))
    const isFarAway = (s: Show) => !airingSoon.has(s.tmdb_id) && nextDate.has(s.tmdb_id)
    const isUndated = (s: Show) => !nextDate.has(s.tmdb_id) && isInProduction(s)
    const hasDate = (s: Show) => nextDate.has(s.tmdb_id) || isInProduction(s)

    return {
      groups: groupUpcoming(onAirSoon, new Map(onAir.map((s) => [s.tmdb_id, s])), now),
      farAway: onAir.filter(isFarAway).sort((a, b) => nextDate.get(a.tmdb_id)!.airstamp.localeCompare(nextDate.get(b.tmdb_id)!.airstamp)),
      undated: onAir.filter(isUndated),
      hiddenFromOnAir: followed.filter((s) => !onAirIds.has(s.tmdb_id) && hasDate(s)).length,
      nextDate,
      upNext,
      notStarted,
      caughtUp,
      airingSoon,
      watchingCount: active.length,
      finishedCount: followed.length - active.length,
    }
  }, [library, now, onAirFilter])

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
        title="Tracking"
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
        ) : !data ? null : view === 'watching' ? (
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
                {data.notStarted.map((show) => {
                  const next = data.nextDate.get(show.tmdb_id)
                  return (
                    <UpNextRow
                      key={show.tmdb_id}
                      show={show}
                      progress={progress(show)}
                      airing={data.airingSoon.has(show.tmdb_id)}
                      emptyText={next ? `Starts ${formatShortDate(next, now)}` : nextSeasonNote(show)}
                    />
                  )
                })}
              </Section>
            )}
            {data.caughtUp.length > 0 && (
              <Section title="Caught up">
                {data.caughtUp.map((show) => {
                  const next = data.nextDate.get(show.tmdb_id)
                  return (
                    <QuietRow
                      key={show.tmdb_id}
                      show={show}
                      detail={next ? `Next: ${episodeLabel([next])} · ${formatShortDate(next, now)}` : nextSeasonNote(show)}
                      airing={data.airingSoon.has(show.tmdb_id)}
                      padded
                    />
                  )
                })}
              </Section>
            )}
            {data.watchingCount === 0 && (
              <Notice>
                {data.finishedCount > 0
                  ? "Nothing to watch right now. Shows you've finished are in the Shows tab under Finished."
                  : 'Shows you follow appear here with your next episode to watch.'}
              </Notice>
            )}
          </div>
        ) : (
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
            {nothingOnAir && <Notice>Nothing in the next {SOON_MONTHS} months for the shows here.</Notice>}
            {data.hiddenFromOnAir > 0 && (
              <p className="px-5 pt-4 text-xs leading-relaxed text-neutral-400">
                {data.hiddenFromOnAir} show{data.hiddenFromOnAir === 1 ? '' : 's'} you're a season or more behind on{' '}
                {data.hiddenFromOnAir === 1 ? 'is' : 'are'} hidden until you reach the current season. Change this in Settings → On air.
              </p>
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
  airing = false,
  padded = false,
}: {
  show: Show
  detail: string
  /** When given, adds a line saying how far behind you are. */
  progress?: Progress
  airing?: boolean
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
          <ShowName name={show.name} className="text-neutral-700 dark:text-neutral-200" />
          <div className="truncate text-sm text-neutral-500 tabular-nums dark:text-neutral-400">{detail}</div>
          {(catchUp || airing) && (
            <div className="mt-0.5 flex items-center gap-2 text-xs tabular-nums">
              {airing && <AiringPill />}
              {catchUp && <span className={behind ? 'font-medium text-accent-text' : 'text-neutral-400'}>{catchUp}</span>}
            </div>
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
          <ShowName name={row.show.name} className="font-medium" />
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
function UpNextRow({
  show,
  progress,
  airing = false,
  emptyText = 'No episode list yet',
}: {
  show: Show
  progress: Progress
  airing?: boolean
  /** What to say when there's no episode to watch yet (e.g. "Starts Thu 23 Oct"). */
  emptyText?: string
}) {
  const ep = progress.next
  const left = ep && progress.started ? `${progress.left} left` : null
  return (
    <li className="flex items-center gap-2 pr-4">
      <button
        onClick={() => navigate(`/show/${show.tmdb_id}`)}
        className="flex min-w-0 flex-1 items-center gap-4 py-2.5 pl-5 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
      >
        <Poster path={show.poster_path} name={show.name} size="sm" />
        <div className="min-w-0 flex-1">
          <ShowName name={show.name} className="font-medium" />
          <div className="truncate text-sm text-neutral-500 dark:text-neutral-400">
            {ep ? (
              <>
                <span className="tabular-nums">{episodeLabel([ep])}</span>
                {ep.name ? ` · ${ep.name}` : ''}
              </>
            ) : (
              emptyText
            )}
          </div>
          {(airing || left) && (
            <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
              {airing && <AiringPill />}
              {left}
            </div>
          )}
        </div>
      </button>
      {ep && <TickButton episodes={[ep]} showName={show.name} />}
    </li>
  )
}

/** Long titles get two lines rather than being cut off after a few words. */
function ShowName({ name, className = '' }: { name: string; className?: string }) {
  return <div className={`line-clamp-2 text-[15px] leading-snug [overflow-wrap:anywhere] ${className}`}>{name}</div>
}

function AiringPill() {
  return (
    <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-text dark:bg-accent/20">
      Still airing
    </span>
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
