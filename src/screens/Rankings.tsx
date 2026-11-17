import { useRef, useState, type TouchEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Bucket, type Ranking, type Show } from '../db'
import { BUCKETS, sortRankings } from '../lib/ranking'
import { navigate } from '../lib/router'
import { myServicesStore } from '../lib/services'
import { Button, Chips, EmptyState, ScreenHeader } from '../components/Layout'
import { Poster } from '../components/Poster'
import { ReadyToRank } from './RankFlow'
import { Suggestions } from './Suggestions'

type View = 'rankings' | 'suggestions'
type SuggestionFilter = 'all' | 'mine'

// Kept outside the component so switching tabs doesn't reset them.
let lastView: View = 'rankings'
let lastSuggestionFilter: SuggestionFilter = 'all'

export function Rankings() {
  const [view, setViewState] = useState<View>(lastView)
  // Which side the new view slides in from; nothing on first show.
  const [from, setFrom] = useState<'left' | 'right' | null>(null)
  const setView = (v: View) => {
    if (v === view) return
    setFrom(v === 'suggestions' ? 'right' : 'left')
    setViewState((lastView = v))
    window.scrollTo(0, 0)
  }
  const swipe = useSwipe((direction) => setView(direction === 'left' ? 'suggestions' : 'rankings'))

  const [filter, setFilter] = useState<Bucket | 'all'>('all')
  const [suggestionFilter, setSuggestionFilterState] = useState(lastSuggestionFilter)
  const setSuggestionFilter = (f: SuggestionFilter) => setSuggestionFilterState((lastSuggestionFilter = f))
  const myServices = myServicesStore.use()

  const rows = useLiveQuery(async () => {
    const rankings = (await db.rankings.toArray()).sort(sortRankings)
    const shows = await db.shows.bulkGet(rankings.map((r) => r.tmdb_show_id))
    return rankings.map((ranking, i) => ({ ranking, show: shows[i] }))
  }, [])
  const chips: { id: Bucket | 'all'; label: string }[] = [{ id: 'all', label: 'All' }, ...BUCKETS.map((b) => ({ id: b.id, label: b.short }))]

  return (
    <>
      <ScreenHeader
        title={<ViewSwitch view={view} onChange={setView} />}
        right={
          view === 'rankings' && rows && rows.length >= 2 ? (
            <button
              onClick={() => navigate('/compare')}
              className="h-8 shrink-0 rounded-full bg-accent/10 px-3 text-sm font-medium text-accent-text active:opacity-70 dark:bg-accent/20"
            >
              Keep comparing
            </button>
          ) : null
        }
      >
        {view === 'rankings'
          ? rows && rows.length > 0 && <Chips options={chips} value={filter} onChange={setFilter} />
          : myServices.length > 0 && (
              <Chips
                options={[
                  { id: 'all', label: 'All' },
                  { id: 'mine', label: 'On my services' },
                ]}
                value={suggestionFilter}
                onChange={setSuggestionFilter}
              />
            )}
      </ScreenHeader>

      {/* key: each switch remounts the view, so it slides in. */}
      <div
        key={view}
        {...swipe}
        className={`min-h-[60vh] ${from === 'right' ? 'motion-safe:animate-from-right' : from === 'left' ? 'motion-safe:animate-from-left' : ''}`}
      >
        {view === 'rankings' ? (
          <RankingsList rows={rows} filter={filter} />
        ) : (
          <Suggestions onlyMine={myServices.length > 0 && suggestionFilter === 'mine'} />
        )}
      </div>
    </>
  )
}

/** "Rankings" and "Suggestions" side by side: the chosen one big, the other small, swapping sizes as you tap. */
function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const views: { id: View; label: string }[] = [
    { id: 'rankings', label: 'Rankings' },
    { id: 'suggestions', label: 'Suggestions' },
  ]
  return (
    <h1 className="flex min-w-0 items-baseline gap-3">
      {views.map((v) => (
        <button
          key={v.id}
          onClick={() => onChange(v.id)}
          aria-pressed={view === v.id}
          className={`font-semibold tracking-tight whitespace-nowrap transition-all duration-300 ease-out ${
            view === v.id ? 'text-2xl text-neutral-900 dark:text-neutral-100' : 'text-base text-neutral-400 active:text-neutral-600 dark:text-neutral-500'
          }`}
        >
          {v.label}
        </button>
      ))}
    </h1>
  )
}

/** A sideways swipe on the content flips between the views. Ignored on rows that scroll sideways themselves. */
function useSwipe(onSwipe: (direction: 'left' | 'right') => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0]
      start.current = (e.target as Element).closest('[data-no-swipe]') ? null : { x: t.clientX, y: t.clientY }
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current
      start.current = null
      if (!s) return
      const t = e.changedTouches[0]
      const [dx, dy] = [t.clientX - s.x, t.clientY - s.y]
      if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) onSwipe(dx < 0 ? 'left' : 'right')
    },
  }
}

function RankingsList({ rows, filter }: { rows: { ranking: Ranking; show: Show | undefined }[] | undefined; filter: Bucket | 'all' }) {
  const visible = rows?.filter((r) => filter === 'all' || r.ranking.bucket === filter) ?? []
  return (
    <>
      <div className="px-5">
        <ReadyToRank />
      </div>

      {rows && rows.length === 0 ? (
        <EmptyState
          title="No rankings yet"
          body="Rank shows you've watched. You'll never type a score: pick how you felt, then answer a few “Which was better?” questions."
          action={<Button onClick={() => navigate('/search', { replace: true })}>Find a show to rank</Button>}
        />
      ) : (
        <ul className="pt-2 pb-6">
          {visible.map(({ ranking, show }) => (
            <li key={ranking.tmdb_show_id}>
              <button
                onClick={() => navigate(`/show/${ranking.tmdb_show_id}`)}
                className="flex w-full items-center gap-4 px-5 py-2.5 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
              >
                <span className="w-10 shrink-0 text-lg font-semibold text-accent-text tabular-nums">{ranking.score.toFixed(1)}</span>
                <Poster path={show?.poster_path} name={show?.name ?? '?'} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[15px] leading-snug font-medium [overflow-wrap:anywhere]">{show?.name ?? 'Unknown show'}</div>
                  {show?.first_air_year && <div className="text-sm text-neutral-500 dark:text-neutral-400">{show.first_air_year}</div>}
                </div>
              </button>
            </li>
          ))}
          {rows && rows.length > 0 && visible.length === 0 && (
            <p className="px-5 pt-8 text-sm text-neutral-500 dark:text-neutral-400">Nothing in this bucket yet.</p>
          )}
        </ul>
      )}
    </>
  )
}
