import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Episode } from '../db'
import { getShowDetails, logoUrl, regionName, useRegion, type ShowDetails } from '../lib/tmdb'
import { follow, setOwned, unfollow } from '../lib/shows'
import { BUCKETS, removeRanking } from '../lib/ranking'
import { episodeLabel, formatAirTime, formatDateOnly } from '../lib/dates'
import { navigate } from '../lib/router'
import { errorMessage, toast } from '../lib/toast'
import { Button, Overlay } from '../components/Layout'
import { Poster } from '../components/Poster'
import { CheckIcon, ExternalIcon, PlusIcon, Spinner } from '../components/Icons'

/** Subscription services come first, so the first few are the useful ones. */
const STREAMING_PREVIEW = 6

export function ShowDetail({ id }: { id: number }) {
  // undefined = still loading, null = not stored on this device
  const stored = useLiveQuery(() => db.shows.get(id).then((s) => s ?? null), [id])
  const ranking = useLiveQuery(() => db.rankings.get(id).then((r) => r ?? null), [id])
  const bucketCount = useLiveQuery(
    () => (ranking ? db.rankings.where('bucket').equals(ranking.bucket).count() : Promise.resolve(0)),
    [ranking?.bucket],
  )
  const nextEpisode = useLiveQuery(async () => {
    const nowIso = new Date().toISOString()
    const eps = await db.episodes.where('tmdb_show_id').equals(id).sortBy('airstamp')
    return eps.find((e) => e.airstamp >= nowIso) ?? null
  }, [id])

  // Shows that aren't followed have no TVmaze data, so lean on TMDB for a preview.
  const [details, setDetails] = useState<ShowDetails | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const needsDetails = stored === null || (stored && !stored.followed)
  const regionCode = useRegion()
  useEffect(() => {
    if (!needsDetails) return
    let cancelled = false
    getShowDetails(id)
      .then((d) => !cancelled && setDetails(d))
      .catch((err) => !cancelled && setLoadError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [id, needsDetails, regionCode])

  const [busy, setBusy] = useState(false)
  const [showAllStreaming, setShowAllStreaming] = useState(false)
  const show = stored ?? (details ? { ...details.show, followed: false } : null)

  if (!show) {
    return (
      <Overlay>
        <div className="flex justify-center pt-24 text-neutral-400">
          {loadError ? <p className="px-8 text-center text-sm">{loadError}</p> : <Spinner />}
        </div>
      </Overlay>
    )
  }

  const toggleFollow = async () => {
    setBusy(true)
    try {
      if (show.followed) {
        await unfollow(id)
        toast(`Unfollowed ${show.name}`)
      } else {
        await follow(id)
        toast(`Following ${show.name}`)
      }
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const unrank = async () => {
    await removeRanking(id)
    toast('Removed from rankings')
  }

  const toggleOwned = async (field: 'own_dvd' | 'own_streaming', value: boolean) => {
    try {
      await setOwned(id, field, value)
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  const meta = [show.first_air_year, show.network, show.status].filter(Boolean).join(' · ')
  // Prefer freshly fetched providers (shows that aren't followed don't get refreshed).
  const streaming = details?.show.streaming ?? show.streaming
  const bucketLabel = ranking ? BUCKETS.find((b) => b.id === ranking.bucket)?.short : null

  return (
    <Overlay>
      <div className="px-5 pt-2 pb-10">
        <div className="flex gap-5">
          <Poster path={show.poster_path} name={show.name} size="lg" />
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">{show.name}</h1>
            {meta && <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">{meta}</p>}
            {ranking && (
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-semibold text-accent-text tabular-nums">{ranking.score.toFixed(1)}</span>
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  {bucketLabel} · #{ranking.position + 1} of {bucketCount ?? '…'}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant={show.followed ? 'secondary' : 'primary'} onClick={toggleFollow} disabled={busy}>
            {busy ? <Spinner /> : show.followed ? <CheckIcon width={18} height={18} /> : <PlusIcon width={18} height={18} />}
            {show.followed ? 'Following' : 'Follow'}
          </Button>
          <Button variant="secondary" onClick={() => navigate(`/rank/${id}`)}>
            {ranking ? 'Re-rank' : 'Rank'}
          </Button>
        </div>

        <NextEpisode
          stored={nextEpisode ?? null}
          fallback={!show.followed ? details?.next_episode ?? null : null}
          followed={show.followed}
        />

        {show.overview && <p className="mt-6 text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">{show.overview}</p>}

        <section className="mt-7">
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            Where to stream · {regionName(regionCode)}
          </h2>
          {streaming.length > 0 ? (
            <>
              <ul className="mt-3 flex flex-wrap gap-3">
                {(showAllStreaming ? streaming : streaming.slice(0, STREAMING_PREVIEW)).map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-full bg-neutral-100 py-1 pr-3 pl-1 text-sm dark:bg-neutral-800">
                    {p.logo_path ? (
                      <img src={logoUrl(p.logo_path)!} alt="" className="h-6 w-6 rounded-full" loading="lazy" />
                    ) : (
                      <span className="h-6 w-6" />
                    )}
                    {p.name}
                  </li>
                ))}
              </ul>
              {!showAllStreaming && streaming.length > STREAMING_PREVIEW && (
                <button onClick={() => setShowAllStreaming(true)} className="mt-3 text-sm text-accent-text">
                  Show {streaming.length - STREAMING_PREVIEW} more
                </button>
              )}
              <p className="mt-2 text-[11px] text-neutral-400">Streaming data from JustWatch</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Not on any streaming service here right now.</p>
          )}
        </section>

        <section className="mt-7">
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Your copies</h2>
          <div className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
            <OwnToggle label="Own on DVD" checked={stored?.own_dvd === true} onChange={(v) => toggleOwned('own_dvd', v)} />
            <OwnToggle
              label="Own on streaming"
              checked={stored?.own_streaming === true}
              onChange={(v) => toggleOwned('own_streaming', v)}
            />
          </div>
        </section>

        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-[15px]">
          {show.imdb_id && (
            <a
              href={`https://www.imdb.com/title/${show.imdb_id}/`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-accent-text"
            >
              IMDb <ExternalIcon width={16} height={16} />
            </a>
          )}
          <a
            href={`https://www.themoviedb.org/tv/${id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-accent-text"
          >
            TMDB <ExternalIcon width={16} height={16} />
          </a>
          {ranking && (
            <button onClick={unrank} className="text-neutral-500 dark:text-neutral-400">
              Remove ranking
            </button>
          )}
        </div>
      </div>
    </Overlay>
  )
}

function NextEpisode({
  stored,
  fallback,
  followed,
}: {
  stored: Episode | null
  fallback: ShowDetails['next_episode']
  followed: boolean
}) {
  let label: string | null = null
  let when: string | null = null
  if (stored) {
    label = `${episodeLabel([stored])}${stored.name ? ` · ${stored.name}` : ''}`
    when = formatAirTime(stored, 'detail')
  } else if (fallback) {
    label = `${episodeLabel([fallback])}${fallback.name ? ` · ${fallback.name}` : ''}`
    when = formatDateOnly(fallback.air_date)
  }
  if (!label) {
    if (!followed) return null
    return <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">No upcoming episodes scheduled.</p>
  }
  return (
    <section className="mt-6 rounded-xl bg-neutral-50 px-4 py-3 dark:bg-neutral-900">
      <div className="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Next episode</div>
      <div className="mt-1 text-[15px] font-medium">{label}</div>
      <div className="text-sm text-neutral-500 tabular-nums dark:text-neutral-400">{when}</div>
    </section>
  )
}

function OwnToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-3 text-[15px]">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 cursor-pointer accent-accent"
      />
    </label>
  )
}
