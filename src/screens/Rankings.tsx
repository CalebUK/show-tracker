import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Bucket, type Ranking, type Show } from '../db'
import { BUCKETS, sortRankings } from '../lib/ranking'
import { navigate } from '../lib/router'
import { myServicesStore } from '../lib/services'
import { Button, Chips, EmptyState, ScreenHeader } from '../components/Layout'
import { Poster } from '../components/Poster'
import { SwitchedView, ViewSwitch, useViewSwitch } from '../components/ViewSwitch'
import { ReadyToRank } from './RankFlow'
import { Suggestions } from './Suggestions'

type View = 'rankings' | 'suggestions'
const VIEWS: { id: View; label: string }[] = [
  { id: 'rankings', label: 'Rankings' },
  { id: 'suggestions', label: 'Suggestions' },
]
type SuggestionFilter = 'all' | 'mine'

// Kept outside the component so switching tabs doesn't reset them.
let lastView: View = 'rankings'
let lastSuggestionFilter: SuggestionFilter = 'all'

export function Rankings() {
  const { view, setView, from, swipe } = useViewSwitch(
    VIEWS.map((v) => v.id),
    lastView,
    (v) => (lastView = v),
  )

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
        title={<ViewSwitch views={VIEWS} value={view} onChange={setView} />}
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

      <SwitchedView view={view} from={from} swipe={swipe}>
        {view === 'rankings' ? (
          <RankingsList rows={rows} filter={filter} />
        ) : (
          <Suggestions onlyMine={myServices.length > 0 && suggestionFilter === 'mine'} />
        )}
      </SwitchedView>
    </>
  )
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
