import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Bucket } from '../db'
import { BUCKETS, sortRankings } from '../lib/ranking'
import { navigate } from '../lib/router'
import { Button, Chips, EmptyState, ScreenHeader } from '../components/Layout'
import { Poster } from '../components/Poster'
import { ReadyToRank } from './RankFlow'

export function Rankings() {
  const [filter, setFilter] = useState<Bucket | 'all'>('all')

  const rows = useLiveQuery(async () => {
    const rankings = (await db.rankings.toArray()).sort(sortRankings)
    const shows = await db.shows.bulkGet(rankings.map((r) => r.tmdb_show_id))
    return rankings.map((ranking, i) => ({ ranking, show: shows[i] }))
  }, [])

  const visible = rows?.filter((r) => filter === 'all' || r.ranking.bucket === filter) ?? []
  const chips: { id: Bucket | 'all'; label: string }[] = [{ id: 'all', label: 'All' }, ...BUCKETS.map((b) => ({ id: b.id, label: b.short }))]

  return (
    <>
      <ScreenHeader title="Rankings">
        {rows && rows.length > 0 && <Chips options={chips} value={filter} onChange={setFilter} />}
      </ScreenHeader>

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
                  <div className="truncate text-[15px] font-medium">{show?.name ?? 'Unknown show'}</div>
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
