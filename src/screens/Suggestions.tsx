import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Provider } from '../db'
import {
  MIN_LIKED,
  becauseLine,
  buildSuggestions,
  hiddenSuggestionsStore,
  hideSuggestion,
  setHiddenSuggestions,
  suggestionStreaming,
  type Suggestion,
  type SuggestionsResult,
} from '../lib/suggestions'
import { myServicesStore, servicesAmong } from '../lib/services'
import { useTmdbKey } from '../lib/tmdb'
import { navigate } from '../lib/router'
import { errorMessage, toast } from '../lib/toast'
import { Button, EmptyState, ServicePill } from '../components/Layout'
import { Poster } from '../components/Poster'
import { CloseIcon, Spinner } from '../components/Icons'

// Kept between visits, so the list shows straight away while it's brought up to date.
let lastResult: SuggestionsResult | null = null

/** Search → Suggestions: shows you might like, built from your rankings (see lib/suggestions). */
export function Suggestions({ onlyMine }: { onlyMine: boolean }) {
  const tmdbKey = useTmdbKey()
  const hidden = hiddenSuggestionsStore.use()
  const myServices = myServicesStore.use()
  // Rebuild when your rankings or the shows in the app change. Cheap: TMDB's lists are cached.
  const signature = useLiveQuery(async () => {
    const [rankings, ids] = await Promise.all([db.rankings.toArray(), db.shows.toCollection().primaryKeys()])
    return `${rankings.map((r) => `${r.tmdb_show_id}:${r.score}`).join(',')}|${ids.join(',')}`
  }, [])
  const [result, setResult] = useState(lastResult)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (signature === undefined || !tmdbKey) return
    let cancelled = false
    buildSuggestions().then(
      (r) => {
        if (cancelled) return
        setResult((lastResult = r))
        setError(null)
      },
      (err) => !cancelled && setError(errorMessage(err)),
    )
    return () => {
      cancelled = true
    }
  }, [signature, hidden, tmdbKey])

  // Where each one streams, for service pills and the On my services filter.
  const items = result?.kind === 'ready' ? result.items : null
  const ids = useMemo(() => items?.map((s) => s.id).join(',') ?? '', [items])
  const [streaming, setStreaming] = useState<Map<number, Provider[]> | null>(null)
  useEffect(() => {
    if (!ids || myServices.length === 0) return
    let cancelled = false
    suggestionStreaming(ids.split(',').map(Number)).then((m) => !cancelled && setStreaming(m))
    return () => {
      cancelled = true
    }
  }, [ids, myServices.length])

  if (!tmdbKey) return <Note>Add your TMDB token in Settings to get suggestions.</Note>
  if (!result) {
    return error ? (
      <Note>{error}</Note>
    ) : (
      <div className="flex flex-col items-center gap-3 pt-24 text-sm text-neutral-500 dark:text-neutral-400">
        <Spinner />
        Finding shows you might like…
      </div>
    )
  }
  if (result.kind === 'need-more') {
    return (
      <EmptyState
        title="Rank a few more shows"
        body={`Suggestions come from shows you rated 6 or higher, so rank at least ${MIN_LIKED} of those (you have ${result.liked}).`}
        action={<Button onClick={() => navigate('/search', { replace: true })}>Find a show to rank</Button>}
      />
    )
  }

  const mineFor = (s: Suggestion) => servicesAmong(streaming?.get(s.id) ?? [], myServices)
  const shown = onlyMine ? result.items.filter((s) => mineFor(s).length > 0) : result.items

  return (
    <>
      {shown.length === 0 ? (
        <Note>
          {onlyMine
            ? streaming
              ? 'None of these are on your streaming services right now.'
              : 'Checking your streaming services…'
            : result.incomplete
              ? "Couldn't reach TMDB for some of your shows. Check your connection and try again."
              : 'No suggestions right now. Rank more shows to widen the net.'}
        </Note>
      ) : (
        <ul className="pt-2">
          {shown.map((s) => (
            <SuggestionRow key={s.id} suggestion={s} services={mineFor(s)} />
          ))}
        </ul>
      )}
      <div className="space-y-1 px-5 pt-4 pb-8 text-xs text-neutral-400">
        {hidden.length > 0 && (
          <p>
            {hidden.length} hidden ·{' '}
            <button onClick={() => setHiddenSuggestions([])} className="text-accent-text">
              Bring them back
            </button>
          </p>
        )}
        <p>Based on TMDB recommendations and ratings.</p>
      </div>
    </>
  )
}

function SuggestionRow({ suggestion: s, services }: { suggestion: Suggestion; services: Provider[] }) {
  const hide = () =>
    hideSuggestion(s.id).then(
      () => toast(`Hidden ${s.name}`),
      (err) => toast(errorMessage(err)),
    )
  return (
    <li className="flex items-center gap-1 pr-3">
      <button
        onClick={() => navigate(`/show/${s.id}`)}
        className="flex min-w-0 flex-1 items-center gap-4 py-2.5 pl-5 text-left active:bg-neutral-50 dark:active:bg-neutral-900"
      >
        <Poster path={s.poster_path} name={s.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[15px] leading-snug font-medium [overflow-wrap:anywhere]">{s.name}</div>
          <div className="flex items-center gap-2 text-sm text-neutral-500 tabular-nums dark:text-neutral-400">
            {s.first_air_year && <span>{s.first_air_year}</span>}
            {/* Labelled, so TMDB's rating isn't mistaken for one of your own scores. */}
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              TMDB ★ {s.vote_average.toFixed(1)}
            </span>
          </div>
          <div className="line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{becauseLine(s.because)}</div>
          {services.length > 0 && (
            <div className="mt-1 flex">
              <ServicePill services={services} />
            </div>
          )}
        </div>
      </button>
      <button onClick={hide} aria-label={`Not interested in ${s.name}`} className="shrink-0 rounded-full p-2 text-neutral-400 active:opacity-60">
        <CloseIcon width={16} height={16} />
      </button>
    </li>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-5 pt-8 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{children}</p>
}
