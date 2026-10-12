import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Ranking } from '../db'
import { randomPair } from '../lib/elo'
import { restoreRankings, saveComparison } from '../lib/ranking'
import { goBack } from '../lib/router'
import { errorMessage, toast } from '../lib/toast'
import { Button, Overlay } from '../components/Layout'
import { Spinner } from '../components/Icons'
import { Choice } from './RankFlow'

type Pair = readonly [number, number]

/**
 * Endless "Which was better?" between two random ranked shows. Every answer is saved straight
 * away and nudges both ratings, so you can stop whenever you like.
 */
export function KeepComparing() {
  const data = useLiveQuery(async () => {
    const rankings = await db.rankings.toArray()
    const shows = await db.shows.bulkGet(rankings.map((r) => r.tmdb_show_id))
    return new Map(rankings.map((r, i) => [r.tmdb_show_id, { name: shows[i]?.name ?? 'Unknown show', poster: shows[i]?.poster_path ?? null }]))
  }, [])
  const ids = useMemo(() => (data ? [...data.keys()] : []), [data])

  const [pair, setPair] = useState<Pair | null>(null)
  const [answered, setAnswered] = useState(0)
  const [history, setHistory] = useState<{ pair: Pair; before: Ranking[] }[]>([])
  const [busy, setBusy] = useState(false)

  // First pair once the rankings have loaded.
  useEffect(() => {
    if (!pair && ids.length >= 2) setPair(randomPair(ids))
  }, [ids, pair])

  if (!data) {
    return (
      <Overlay fallback="/rankings">
        <div className="flex justify-center pt-24 text-neutral-400">
          <Spinner />
        </div>
      </Overlay>
    )
  }

  if (ids.length < 2) {
    return (
      <Overlay fallback="/rankings">
        <p className="px-8 pt-24 text-center text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          Rank at least two shows first, then come back to compare them.
        </p>
      </Overlay>
    )
  }

  if (!pair) return null
  const [aId, bId] = pair
  const a = data.get(aId)!
  const b = data.get(bId)!

  const answer = async (result: number) => {
    setBusy(true)
    try {
      const before = await saveComparison(aId, bId, result)
      setHistory((h) => [...h, { pair, before }])
      setAnswered((n) => n + 1)
      setPair(randomPair(ids, pair))
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    const last = history[history.length - 1]
    if (!last) return
    await restoreRankings(last.before)
    setHistory((h) => h.slice(0, -1))
    setAnswered((n) => n - 1)
    setPair(last.pair)
  }

  return (
    <Overlay fallback="/rankings">
      <div className="px-5 pt-4 pb-10">
        <h1 className="text-center text-xl font-semibold tracking-tight">Which was better?</h1>
        <p className="mt-1 text-center text-sm text-neutral-500 tabular-nums dark:text-neutral-400">
          {answered === 0 ? 'Random pairs from your rankings' : `${answered} compared`}
        </p>
        <div className={`mt-8 grid grid-cols-2 gap-4 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          <Choice name={a.name} poster={a.poster} onClick={() => answer(1)} />
          <Choice name={b.name} poster={b.poster} onClick={() => answer(0)} />
        </div>
        <div className="mt-8 flex flex-col items-center gap-2">
          <div className="grid w-full max-w-xs grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => answer(0.5)} disabled={busy}>
              Too close
            </Button>
            <Button variant="secondary" onClick={() => setPair(randomPair(ids, pair))} disabled={busy}>
              Skip
            </Button>
          </div>
          {history.length > 0 && (
            <Button variant="ghost" onClick={undo} disabled={busy}>
              Undo
            </Button>
          )}
          <Button className="mt-4 w-full max-w-xs" onClick={() => goBack('/rankings')}>
            Done
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
