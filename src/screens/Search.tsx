import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { searchShows, useTmdbKey, type SearchResult } from '../lib/tmdb'
import { follow } from '../lib/shows'
import { followAndWatchAll } from '../lib/watched'
import { navigate } from '../lib/router'
import { errorMessage, toast } from '../lib/toast'
import { useOnline } from '../hooks/useOnline'
import { IosInstallNote, ScreenHeader, Sheet } from '../components/Layout'
import { TmdbKeyForm, TmdbKeyHelp } from '../components/TmdbKeyForm'
import { Poster } from '../components/Poster'
import { CheckIcon, CloseIcon, PlusIcon, SearchIcon, Spinner } from '../components/Icons'

// Kept outside the component so switching tabs doesn't lose the search.
let lastQuery = ''
let lastResults: SearchResult[] | null = null

export function Search() {
  const online = useOnline()
  const tmdbKey = useTmdbKey()
  const [query, setQuery] = useState(lastQuery)
  const [results, setResults] = useState<SearchResult[] | null>(lastResults)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const status = useLiveQuery(async () => {
    const [shows, rankings] = await Promise.all([db.shows.toArray(), db.rankings.toArray()])
    return {
      followed: new Set(shows.filter((s) => s.followed).map((s) => s.tmdb_id)),
      ranked: new Map(rankings.map((r) => [r.tmdb_show_id, r.score])),
    }
  }, [])

  useEffect(() => {
    lastQuery = query
    const q = query.trim()
    if (q.length < 2 || !tmdbKey) {
      // Drop any search still in flight, so its results don't land under a cleared box.
      requestId.current++
      setLoading(false)
      if (!q) setResults((lastResults = null))
      return
    }
    const id = ++requestId.current
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const found = await searchShows(q)
        if (id !== requestId.current) return
        setResults((lastResults = found))
        setError(null)
      } catch (err) {
        if (id === requestId.current) setError(errorMessage(err))
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [query, tmdbKey])

  return (
    <>
      <ScreenHeader title="Search">
        <div className="px-5 pb-3">
          <label className="flex h-11 items-center gap-2 rounded-xl bg-neutral-100 px-3 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <SearchIcon width={18} height={18} />
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Shows"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="h-full min-w-0 flex-1 bg-transparent text-base text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 [&::-webkit-search-cancel-button]:hidden"
            />
            {loading ? (
              <Spinner className="h-4 w-4" />
            ) : query ? (
              <button onClick={() => setQuery('')} aria-label="Clear search" className="p-1">
                <CloseIcon width={16} height={16} />
              </button>
            ) : null}
          </label>
        </div>
      </ScreenHeader>

      <IosInstallNote className="mx-5 mt-2" />

      {!tmdbKey ? (
        <div className="px-5 pt-6">
          <h2 className="mb-2 text-[15px] font-medium">Add your TMDB key to search</h2>
          <TmdbKeyHelp />
          <TmdbKeyForm />
        </div>
      ) : !online ? (
        <Notice>Search needs a connection.</Notice>
      ) : error ? (
        <Notice>{error}</Notice>
      ) : results && results.length === 0 && !loading ? (
        <Notice>No shows found.</Notice>
      ) : (
        <ul className="pb-6">
          {results?.map((r) => (
            <ResultRow key={r.id} result={r} followed={status?.followed.has(r.id) ?? false} score={status?.ranked.get(r.id)} />
          ))}
        </ul>
      )}

      {!results && tmdbKey && (
        <p className="px-5 pt-6 text-xs text-neutral-400">Show data from TMDB · Schedules from TVmaze</p>
      )}
    </>
  )
}

function ResultRow({ result, followed, score }: { result: SearchResult; followed: boolean; score: number | undefined }) {
  const [busy, setBusy] = useState<'track' | 'watched' | null>(null)
  const [choosing, setChoosing] = useState(false)
  const year = result.first_air_date?.slice(0, 4)

  const startTracking = async () => {
    setBusy('track')
    try {
      await follow(result.id)
      setChoosing(false)
      toast(`Tracking ${result.name}`)
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  /** Follow it, tick every episode, then go straight into rating it. */
  const watchedItAll = async () => {
    setBusy('watched')
    try {
      const ticked = await followAndWatchAll(result.id, { promptToRate: false })
      setChoosing(false)
      toast(ticked ? `Ticked all ${ticked} episodes. Now rate it` : `Following ${result.name}. Now rate it`)
      navigate(`/rank/${result.id}`)
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="flex items-center gap-3 pr-3 pl-5">
      <button onClick={() => navigate(`/show/${result.id}`)} className="flex min-w-0 flex-1 items-center gap-4 py-2.5 text-left">
        <Poster path={result.poster_path} name={result.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[15px] leading-snug font-medium [overflow-wrap:anywhere]">{result.name}</div>
          <div className="truncate text-sm text-neutral-500 dark:text-neutral-400">
            {[year, score != null ? `Ranked ${score.toFixed(1)}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      </button>
      <button
        onClick={() => (followed ? navigate(`/show/${result.id}`) : setChoosing(true))}
        aria-label={followed ? 'Following' : `Add ${result.name}`}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
          followed ? 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400' : 'bg-accent text-white'
        }`}
      >
        {followed ? <CheckIcon width={18} height={18} /> : <PlusIcon width={18} height={18} />}
      </button>

      <Sheet open={choosing} onClose={() => !busy && setChoosing(false)}>
        <div className="flex items-center gap-4">
          <Poster path={result.poster_path} name={result.name} size="sm" />
          <div className="min-w-0">
            <div className="truncate text-[17px] font-semibold">{result.name}</div>
            {year && <div className="text-sm text-neutral-500 dark:text-neutral-400">{year}</div>}
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          <SheetOption
            title="Start tracking"
            body="Follow it and see its episodes on Tracking."
            onClick={startTracking}
            busy={busy === 'track'}
            disabled={busy != null}
            primary
          />
          <SheetOption
            title="Watched it all"
            body="Tick every episode, then rate it."
            onClick={watchedItAll}
            busy={busy === 'watched'}
            disabled={busy != null}
          />
          <button onClick={() => setChoosing(false)} disabled={busy != null} className="h-11 text-[15px] text-neutral-500 dark:text-neutral-400">
            Cancel
          </button>
        </div>
      </Sheet>
    </li>
  )
}

function SheetOption({
  title,
  body,
  onClick,
  busy,
  disabled,
  primary = false,
}: {
  title: string
  body: string
  onClick: () => void
  busy: boolean
  disabled: boolean
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-16 items-center gap-3 rounded-xl px-4 py-3 text-left transition active:opacity-80 disabled:opacity-60 ${
        primary ? 'bg-accent text-white' : 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
      }`}
    >
      <span className="flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className={`block text-sm ${primary ? 'text-white/80' : 'text-neutral-500 dark:text-neutral-400'}`}>{body}</span>
      </span>
      {busy && <Spinner className="h-5 w-5" />}
    </button>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="px-5 pt-8 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400 [&_code]:text-[13px]">{children}</p>
}
