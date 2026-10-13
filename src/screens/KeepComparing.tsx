import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Ranking } from '../db'
import { pairKey, randomPair } from '../lib/elo'
import { restoreRankings, saveComparison } from '../lib/ranking'
import { goBack, navigate } from '../lib/router'
import { errorMessage, toast } from '../lib/toast'
import { Button, Overlay } from '../components/Layout'
import { Spinner } from '../components/Icons'
import { Choice } from './RankFlow'

type Pair = readonly [number, number]

/**
 * "Which was better?" between two random ranked shows. Every answer is saved straight away and
 * nudges both ratings, so you can stop whenever you like. Each pair comes up once per session;
 * when they've all been used, it suggests ranking more shows.
 */
export function KeepComparing() {
  const data = useLiveQuery(async () => {
    const rankings = await db.rankings.toArray()
    const shows = await db.shows.bulkGet(rankings.map((r) => r.tmdb_show_id))
    // Shows excluded from rating never come up.
    return new Map(
      rankings.flatMap((r, i): [number, { name: string; poster: string | null }][] =>
        shows[i]?.exclude_from_rating ? [] : [[r.tmdb_show_id, { name: shows[i]?.name ?? 'Unknown show', poster: shows[i]?.poster_path ?? null }]],
      ),
    )
  }, [])
  const ids = useMemo(() => (data ? [...data.keys()] : []), [data])

  // undefined until the first pick; null once every pair has come up.
  const [pair, setPair] = useState<Pair | null | undefined>(undefined)
  // Pairs answered or skipped this session.
  const used = useRef(new Set<string>())
  const [answered, setAnswered] = useState(0)
  const [history, setHistory] = useState<{ pair: Pair; before: Ranking[] }[]>([])
  const [busy, setBusy] = useState(false)

  // First pair once the rankings have loaded.
  useEffect(() => {
    if (pair === undefined && ids.length >= 2) setPair(randomPair(ids, used.current))
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

  if (pair === undefined) return null

  const moveOn = (from: Pair) => {
    used.current.add(pairKey(...from))
    setPair(randomPair(ids, used.current))
  }

  const answer = async (current: Pair, result: number) => {
    setBusy(true)
    try {
      const before = await saveComparison(current[0], current[1], result)
      setHistory((h) => [...h, { pair: current, before }])
      setAnswered((n) => n + 1)
      moveOn(current)
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
    used.current.delete(pairKey(...last.pair))
    setPair(last.pair)
  }

  const undoButton = history.length > 0 && (
    <Button variant="ghost" onClick={undo} disabled={busy}>
      Undo
    </Button>
  )

  if (pair === null) {
    return (
      <Overlay fallback="/rankings">
        <div className="flex flex-col items-center px-8 pt-20 pb-10 text-center">
          <h1 className="text-xl font-semibold tracking-tight">That's every pair</h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
            You've been through all {(ids.length * (ids.length - 1)) / 2} pairs of your {ids.length} ranked shows this
            session{answered > 0 ? ` (${answered} compared)` : ''}. Rank more shows to keep comparing.
          </p>
          <div className="mt-8 flex w-full max-w-xs flex-col gap-2">
            <Button onClick={() => navigate('/search', { replace: true })}>Find a show to rank</Button>
            <Button variant="secondary" onClick={() => goBack('/rankings')}>
              Done
            </Button>
            {undoButton}
          </div>
        </div>
      </Overlay>
    )
  }

  const [aId, bId] = pair
  const a = data.get(aId)!
  const b = data.get(bId)!

  return (
    <Overlay fallback="/rankings">
      <div className="px-5 pt-4 pb-10">
        <h1 className="text-center text-xl font-semibold tracking-tight">Which was better?</h1>
        <p className="mt-1 text-center text-sm text-neutral-500 tabular-nums dark:text-neutral-400">
          {answered === 0 ? 'Random pairs from your rankings' : `${answered} compared`}
        </p>
        <div className={`mt-8 grid grid-cols-2 gap-4 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          <Choice name={a.name} poster={a.poster} onClick={() => answer(pair, 1)} />
          <Choice name={b.name} poster={b.poster} onClick={() => answer(pair, 0)} />
        </div>
        <div className="mt-8 flex flex-col items-center gap-2">
          <div className="grid w-full max-w-xs grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => answer(pair, 0.5)} disabled={busy}>
              Too close
            </Button>
            <Button variant="secondary" onClick={() => moveOn(pair)} disabled={busy}>
              Skip
            </Button>
          </div>
          {undoButton}
          <Button className="mt-4 w-full max-w-xs" onClick={() => goBack('/rankings')}>
            Done
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
