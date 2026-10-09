import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Bucket, type Show } from '../db'
import { loadShow } from '../lib/shows'
import {
  BUCKETS,
  bucketShows,
  comparisonsLeft,
  isPlaced,
  midpoint,
  narrow,
  placeShow,
  type SearchRange,
} from '../lib/ranking'
import { goBack } from '../lib/router'
import { errorMessage } from '../lib/toast'
import { Button, Overlay } from '../components/Layout'
import { Poster } from '../components/Poster'
import { Spinner } from '../components/Icons'

type Opponent = { id: number; name: string; poster_path: string | null }

type Step =
  | { kind: 'bucket' }
  | { kind: 'compare'; bucket: Bucket; list: Opponent[]; range: SearchRange; history: SearchRange[] }
  | { kind: 'saving' }
  | { kind: 'done'; bucket: Bucket; position: number; count: number; score: number }

export function RankFlow({ id }: { id: number }) {
  const [show, setShow] = useState<Show | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'bucket' })
  const current = useLiveQuery(() => db.rankings.get(id).then((r) => r ?? null), [id])

  useEffect(() => {
    loadShow(id).then(setShow, (err) => setError(errorMessage(err)))
  }, [id])

  const place = async (bucket: Bucket, index: number) => {
    if (!show) return
    setStep({ kind: 'saving' })
    try {
      await placeShow(show, bucket, index)
      const ranking = await db.rankings.get(id)
      const count = await db.rankings.where('bucket').equals(bucket).count()
      setStep({ kind: 'done', bucket, position: ranking?.position ?? index, count, score: ranking?.score ?? 0 })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const pickBucket = async (bucket: Bucket) => {
    // When re-ranking, leave this show out so it isn't compared against itself.
    const others = await bucketShows(bucket, id)
    if (others.length === 0) return place(bucket, 0)
    const list = others.map(({ ranking, show }) => ({
      id: ranking.tmdb_show_id,
      name: show?.name ?? 'Unknown show',
      poster_path: show?.poster_path ?? null,
    }))
    setStep({ kind: 'compare', bucket, list, range: { low: 0, high: list.length }, history: [] })
  }

  if (error) {
    return (
      <Overlay>
        <p className="px-8 pt-24 text-center text-sm text-neutral-500">{error}</p>
      </Overlay>
    )
  }
  if (!show || current === undefined || step.kind === 'saving') {
    return (
      <Overlay>
        <div className="flex justify-center pt-24 text-neutral-400">
          <Spinner />
        </div>
      </Overlay>
    )
  }

  if (step.kind === 'bucket') {
    return (
      <Overlay>
        <div className="flex flex-col items-center px-6 pt-6 pb-10 text-center">
          <Poster path={show.poster_path} name={show.name} size="lg" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">How was {show.name}?</h1>
          {current && (
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Currently {current.score.toFixed(1)} · {BUCKETS.find((b) => b.id === current.bucket)?.short}
            </p>
          )}
          <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
            {BUCKETS.map((b) => (
              <Button key={b.id} variant="secondary" onClick={() => pickBucket(b.id)} className="h-14 text-base">
                {b.label}
              </Button>
            ))}
          </div>
        </div>
      </Overlay>
    )
  }

  if (step.kind === 'compare') {
    const { bucket, list, range, history } = step
    const mid = midpoint(range)
    const opponent = list[mid]
    const answer = (newIsBetter: boolean) => {
      const next = narrow(range, newIsBetter)
      if (isPlaced(next)) place(bucket, next.low)
      else setStep({ ...step, range: next, history: [...history, range] })
    }
    const undo = () =>
      history.length
        ? setStep({ ...step, range: history[history.length - 1], history: history.slice(0, -1) })
        : setStep({ kind: 'bucket' })
    const left = comparisonsLeft(range)

    return (
      <Overlay>
        <div className="px-5 pt-4 pb-10">
          <h1 className="text-center text-xl font-semibold tracking-tight">Which was better?</h1>
          <p className="mt-1 text-center text-sm text-neutral-500 dark:text-neutral-400">
            {left <= 1 ? 'Last one' : `About ${left} more`}
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4">
            <Choice name={show.name} poster={show.poster_path} onClick={() => answer(true)} />
            <Choice name={opponent.name} poster={opponent.poster_path} onClick={() => answer(false)} />
          </div>
          <div className="mt-8 flex flex-col items-center gap-2">
            {/* Too close to call: settle it right next to the show it was compared with. */}
            <Button variant="secondary" onClick={() => place(bucket, mid + 1)}>
              Too close to call
            </Button>
            <Button variant="ghost" onClick={undo}>
              Undo
            </Button>
          </div>
        </div>
      </Overlay>
    )
  }

  const bucketLabel = BUCKETS.find((b) => b.id === step.bucket)?.short
  return (
    <Overlay>
      <div className="flex flex-col items-center px-6 pt-10 pb-10 text-center">
        <Poster path={show.poster_path} name={show.name} size="lg" />
        <div className="mt-6 text-5xl font-semibold text-accent-text tabular-nums">{step.score.toFixed(1)}</div>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          {bucketLabel} · #{step.position + 1} of {step.count}
        </p>
        <Button className="mt-10 w-full max-w-xs" onClick={() => goBack('/rankings')}>
          Done
        </Button>
      </div>
    </Overlay>
  )
}

function Choice({ name, poster, onClick }: { name: string; poster: string | null; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex flex-col items-center text-center transition active:scale-[0.97]">
      <div className="w-full overflow-hidden rounded-xl shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <Poster path={poster} name={name} size="fill" />
      </div>
      <span className="mt-3 line-clamp-2 text-[15px] font-medium">{name}</span>
    </button>
  )
}
