import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { searchShows, useTmdbKey, type SearchResult } from '../lib/tmdb'
import { follow } from '../lib/shows'
import { navigate } from '../lib/router'
import { errorMessage, toast } from '../lib/toast'
import { useOnline } from '../hooks/useOnline'
import { IosInstallNote, ScreenHeader } from '../components/Layout'
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
  const [busy, setBusy] = useState(false)
  const year = result.first_air_date?.slice(0, 4)

  const onFollow = async () => {
    if (followed) return navigate(`/show/${result.id}`)
    setBusy(true)
    try {
      await follow(result.id)
      toast(`Following ${result.name}`)
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex items-center gap-3 pr-3 pl-5">
      <button onClick={() => navigate(`/show/${result.id}`)} className="flex min-w-0 flex-1 items-center gap-4 py-2.5 text-left">
        <Poster path={result.poster_path} name={result.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{result.name}</div>
          <div className="truncate text-sm text-neutral-500 dark:text-neutral-400">
            {[year, score != null ? `Ranked ${score.toFixed(1)}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      </button>
      <button onClick={() => navigate(`/rank/${result.id}`)} className="h-9 shrink-0 rounded-full px-3 text-sm font-medium text-accent-text">
        {score != null ? 'Re-rank' : 'Rank'}
      </button>
      <button
        onClick={onFollow}
        disabled={busy}
        aria-label={followed ? 'Following' : 'Follow'}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
          followed ? 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400' : 'bg-accent text-white'
        }`}
      >
        {busy ? <Spinner className="h-4 w-4" /> : followed ? <CheckIcon width={18} height={18} /> : <PlusIcon width={18} height={18} />}
      </button>
    </li>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="px-5 pt-8 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400 [&_code]:text-[13px]">{children}</p>
}
