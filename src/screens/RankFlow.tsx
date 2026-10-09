import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Bucket, type Show } from '../db'
import { loadShow } from '../lib/shows'
import { BUCKETS, rankedPool, saveRanking, sortRankings, type Opponent } from '../lib/ranking'
import { COMPARISONS, K_NEW, K_OPPONENT, K_REFINE, eloUpdate, pickOpponent, ratingToScore, startingRating } from '../lib/elo'
import { goBack, navigate } from '../lib/router'
import { errorMessage } from '../lib/toast'
import { Button, Overlay } from '../components/Layout'
import { Poster } from '../components/Poster'
import { Spinner } from '../components/Icons'

/** One ranking session: the show's rating so far, and the pool with ratings adjusted as you answer. */
interface Session {
  bucket: Bucket
  rating: number
  k: number
  pool: Opponent[]
  /** Shows already compared, in order. */
  used: number[]
  total: number
  /** Comparisons from earlier rankings (when fine-tuning). */
  previousComparisons: number
  history: Pick<Session, 'rating' | 'pool' | 'used'>[]
}

type Step =
  | { kind: 'bucket' }
  | { kind: 'compare'; session: Session }
  | { kind: 'saving' }
  | { kind: 'done'; bucket: Bucket; score: number; rank: number; count: number }

export function RankFlow({ id }: { id: number }) {
  const [show, setShow] = useState<Show | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'bucket' })
  const current = useLiveQuery(() => db.rankings.get(id).then((r) => r ?? null), [id])
  const othersRanked = useLiveQuery(() => db.rankings.filter((r) => r.tmdb_show_id !== id).count(), [id])

  useEffect(() => {
    loadShow(id).then(setShow, (err) => setError(errorMessage(err)))
  }, [id])

  const finish = async (s: Session) => {
    if (!show) return
    setStep({ kind: 'saving' })
    try {
      const opponents = new Map(s.pool.filter((o) => s.used.includes(o.id)).map((o) => [o.id, o.rating]))
      await saveRanking(show, { bucket: s.bucket, rating: s.rating, comparisons: s.previousComparisons + s.used.length, opponents })
      const all = (await db.rankings.toArray()).sort(sortRankings)
      setStep({
        kind: 'done',
        bucket: s.bucket,
        score: ratingToScore(s.bucket, s.rating),
        rank: all.findIndex((r) => r.tmdb_show_id === id) + 1,
        count: all.length,
      })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /** Start fresh in a bucket, or (`refine`) keep the current rating and ask a few more questions. */
  const start = async (bucket: Bucket, refine = false) => {
    const pool = await rankedPool(id)
    const session: Session = {
      bucket,
      rating: refine && current ? current.rating : startingRating(bucket),
      k: refine ? K_REFINE : K_NEW,
      pool,
      used: [],
      total: Math.min(COMPARISONS, pool.length),
      previousComparisons: refine && current ? current.comparisons : 0,
      history: [],
    }
    if (session.total === 0) return finish(session)
    setStep({ kind: 'compare', session })
  }

  if (error) {
    return (
      <Overlay>
        <p className="px-8 pt-24 text-center text-sm text-neutral-500">{error}</p>
      </Overlay>
    )
  }
  if (!show || current === undefined || othersRanked === undefined || step.kind === 'saving') {
    return (
      <Overlay>
        <div className="flex justify-center pt-24 text-neutral-400">
          <Spinner />
        </div>
      </Overlay>
    )
  }

  if (step.kind === 'bucket') {
    const currentBucket = current && BUCKETS.find((b) => b.id === current.bucket)
    return (
      <Overlay>
        <div className="flex flex-col items-center px-6 pt-6 pb-10 text-center">
          <Poster path={show.poster_path} name={show.name} size="lg" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">How was {show.name}?</h1>
          {current && currentBucket && (
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Currently {current.score.toFixed(1)} · {currentBucket.short}
            </p>
          )}
          <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
            {current && currentBucket && othersRanked > 0 && (
              <>
                <Button onClick={() => start(current.bucket, true)} className="h-14 text-base">
                  Compare more
                </Button>
                <p className="mt-2 mb-1 text-xs text-neutral-500 dark:text-neutral-400">Or start again:</p>
              </>
            )}
            {BUCKETS.map((b) => (
              <Button key={b.id} variant="secondary" onClick={() => start(b.id)} className="h-14 text-base">
                {b.label}
              </Button>
            ))}
          </div>
          {othersRanked === 0 && (
            <p className="mt-6 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
              This is your first ranked show, so there's nothing to compare it with yet. Rank a few more and the questions start.
            </p>
          )}
        </div>
      </Overlay>
    )
  }

  if (step.kind === 'compare') {
    const s = step.session
    const opponent = pickOpponent(s.rating, s.bucket, s.pool, new Set(s.used))!
    const answer = (result: number) => {
      const [rating, opponentRating] = eloUpdate(s.rating, opponent.rating, result, s.k, K_OPPONENT)
      const next: Session = {
        ...s,
        rating,
        pool: s.pool.map((o) => (o.id === opponent.id ? { ...o, rating: opponentRating } : o)),
        used: [...s.used, opponent.id],
        history: [...s.history, { rating: s.rating, pool: s.pool, used: s.used }],
      }
      if (next.used.length >= next.total) finish(next)
      else setStep({ kind: 'compare', session: next })
    }
    const undo = () => {
      const last = s.history[s.history.length - 1]
      if (!last) return setStep({ kind: 'bucket' })
      setStep({ kind: 'compare', session: { ...s, ...last, history: s.history.slice(0, -1) } })
    }

    return (
      <Overlay>
        <div className="px-5 pt-4 pb-10">
          <h1 className="text-center text-xl font-semibold tracking-tight">Which was better?</h1>
          <p className="mt-1 text-center text-sm text-neutral-500 tabular-nums dark:text-neutral-400">
            Question {s.used.length + 1} of {s.total}
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4">
            <Choice name={show.name} poster={show.poster_path} onClick={() => answer(1)} />
            <Choice name={opponent.name} poster={opponent.poster_path} onClick={() => answer(0)} />
          </div>
          <div className="mt-8 flex flex-col items-center gap-2">
            <Button variant="secondary" onClick={() => answer(0.5)}>
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
          {bucketLabel} · #{step.rank} of {step.count} overall
        </p>
        <Button className="mt-10 w-full max-w-xs" onClick={() => goBack('/rankings')}>
          Done
        </Button>
        <ReadyToRank excludeId={id} title="Rank another show you've been watching" />
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

/**
 * Shows you've ticked episodes of but haven't ranked yet. Ranking them gives later
 * rankings more to compare against.
 */
export function ReadyToRank({ excludeId, title = 'Ready to rank' }: { excludeId?: number; title?: string }) {
  const shows = useLiveQuery(async () => {
    const [watched, ranked] = await Promise.all([db.watched.orderBy('tmdb_show_id').uniqueKeys(), db.rankings.toCollection().primaryKeys()])
    const rankedIds = new Set(ranked)
    const ids = (watched as number[]).filter((id) => id !== excludeId && !rankedIds.has(id))
    return (await db.shows.bulkGet(ids)).filter((s): s is Show => !!s).sort((a, b) => a.name.localeCompare(b.name))
  }, [excludeId])

  if (!shows?.length) return null
  return (
    <section className="mt-10 w-full text-left">
      <h2 className="px-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{title}</h2>
      <ul className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {shows.map((s) => (
          <li key={s.tmdb_id} className="w-20 shrink-0">
            <button onClick={() => navigate(`/rank/${s.tmdb_id}`, { replace: excludeId != null })} className="w-full text-left">
              <Poster path={s.poster_path} name={s.name} size="fill" />
              <span className="mt-1.5 line-clamp-2 block text-xs">{s.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
