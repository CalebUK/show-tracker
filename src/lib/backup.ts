import { db, episodeKey, setMeta, type Bucket, type Episode, type Provider, type Ranking, type Show, type Watched } from '../db'
import { QUESTION_OPTIONS, ratingToScore, scoreToRating, startingRating, type QuestionSetting } from './elo'
import type { OnAirFilter } from './onAir'
import type { ThemePref } from './theme'
import type { TrackingView } from './trackingView'

/** Per-phone settings, so a new phone is set up in one go. The TMDB token is never included. */
export interface BackupSettings {
  /** '' = automatic */
  region?: string
  services?: Provider[]
  onAirFilter?: OnAirFilter
  trackingView?: TrackingView
  rankingQuestions?: QuestionSetting
  theme?: ThemePref
}

export interface BackupFile {
  app: 'show-tracker'
  /** 1 = no watched episodes, 2 = rankings by position, 3 = no settings. All still import. */
  version: 4
  exported_at: string
  shows: Show[]
  episodes: Episode[]
  rankings: Ranking[]
  watched: Watched[]
  settings: BackupSettings
}

export async function buildBackup(settings: BackupSettings = {}): Promise<File> {
  const [shows, episodes, rankings, watched] = await Promise.all([
    db.shows.toArray(),
    db.episodes.toArray(),
    db.rankings.toArray(),
    db.watched.toArray(),
  ])
  const backup = {
    app: 'show-tracker',
    version: 4,
    exported_at: new Date().toISOString(),
    // "Where to stream" changes all the time, so it isn't kept in backups; it always comes fresh from TMDB.
    shows: shows.map(({ streaming, ...show }) => show),
    episodes,
    rankings,
    watched,
    settings,
  }
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return new File([JSON.stringify(backup, null, 2)], `show-tracker-backup-${stamp}.json`, { type: 'application/json' })
}

export type SaveResult = 'shared' | 'downloaded' | 'cancelled' | 'needs-tap'

/**
 * With `share` (iPhone), use the share sheet so the file can go to Files / iCloud Drive. Safari may
 * refuse if too much time passed since the tap; the caller then shows a button to try again
 * (`fromTap`), and if a fresh tap is refused too, it downloads instead.
 * Everywhere else it's a plain download: Chrome on Android offers the share sheet for files but
 * refuses .json ones, so sharing there never got anywhere.
 */
export async function saveFile(file: File, { share = false, fromTap = false } = {}): Promise<SaveResult> {
  if (share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      await markBackedUp()
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      if (err instanceof DOMException && err.name === 'NotAllowedError' && !fromTap) return 'needs-tap'
      // Any other failure: fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  await markBackedUp()
  return 'downloaded'
}

async function markBackedUp() {
  await setMeta('lastBackupAt', new Date().toISOString())
}

const BUCKETS: Bucket[] = ['liked', 'fine', 'disliked']
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null)

/** Parse and validate a backup file. Throws an Error with a readable message if it's not usable. */
export function parseBackup(text: string): BackupFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  if (!isObj(data) || data.app !== 'show-tracker') throw new Error("That doesn't look like a Show Tracker backup.")
  if (![1, 2, 3, 4].includes(data.version as number)) throw new Error(`Unsupported backup version: ${String(data.version)}`)
  if (!Array.isArray(data.shows) || !Array.isArray(data.episodes) || !Array.isArray(data.rankings)) {
    throw new Error('The backup is missing shows, episodes or rankings.')
  }

  const shows: Show[] = data.shows.map((s, i) => {
    if (!isObj(s) || !num(s.tmdb_id) || typeof s.name !== 'string') throw new Error(`Show #${i + 1} is invalid.`)
    return {
      tmdb_id: s.tmdb_id as number,
      tvmaze_id: num(s.tvmaze_id) ? (s.tvmaze_id as number) : null,
      imdb_id: strOrNull(s.imdb_id),
      name: s.name,
      poster_path: strOrNull(s.poster_path),
      overview: typeof s.overview === 'string' ? s.overview : '',
      status: typeof s.status === 'string' ? s.status : '',
      network: strOrNull(s.network),
      // Ignored even if an older backup has it: it's re-fetched from TMDB after restoring.
      streaming: [],
      first_air_year: strOrNull(s.first_air_year),
      followed: s.followed === true,
      followed_at: strOrNull(s.followed_at),
      last_refreshed_at: strOrNull(s.last_refreshed_at),
      own_dvd: s.own_dvd === true,
      own_streaming: s.own_streaming === true,
      stopped: s.stopped === true,
      exclude_from_rating: s.exclude_from_rating === true,
      // TMDB's next-season info; refreshed from TMDB anyway, so only kept if well-formed.
      next_air:
        isObj(s.next_air) && typeof s.next_air.date === 'string' && num(s.next_air.season) && num(s.next_air.number)
          ? { date: s.next_air.date, season: s.next_air.season as number, number: s.next_air.number as number }
          : null,
      in_production: s.in_production === true,
      latest_season: num(s.latest_season) ? (s.latest_season as number) : null,
      last_aired_season: num(s.last_aired_season) ? (s.last_aired_season as number) : null,
    }
  })
  const showIds = new Set(shows.map((s) => s.tmdb_id))

  const episodes: Episode[] = data.episodes.map((e, i) => {
    if (!isObj(e) || !num(e.id) || !num(e.tmdb_show_id) || typeof e.airstamp !== 'string' || Number.isNaN(Date.parse(e.airstamp))) {
      throw new Error(`Episode #${i + 1} is invalid.`)
    }
    return {
      id: e.id as number,
      tmdb_show_id: e.tmdb_show_id as number,
      season: num(e.season) ? (e.season as number) : 0,
      number: num(e.number) ? (e.number as number) : null,
      name: typeof e.name === 'string' ? e.name : '',
      airstamp: new Date(e.airstamp).toISOString(),
      has_time: e.has_time !== false,
      runtime: num(e.runtime) ? (e.runtime as number) : null,
      runtime_checked: e.runtime_checked === true,
    }
  })

  const rankings: Ranking[] = data.rankings.map((r, i) => {
    if (!isObj(r) || !num(r.tmdb_show_id) || !BUCKETS.includes(r.bucket as Bucket)) {
      throw new Error(`Ranking #${i + 1} is invalid.`)
    }
    if (!showIds.has(r.tmdb_show_id as number)) throw new Error(`Ranking #${i + 1} refers to a show that isn't in the backup.`)
    const bucket = r.bucket as Bucket
    // Older backups have no rating; their score converts straight to one.
    const rating = num(r.rating) ? (r.rating as number) : num(r.score) ? scoreToRating(r.score as number) : startingRating(bucket)
    return {
      tmdb_show_id: r.tmdb_show_id as number,
      bucket,
      rating,
      comparisons: num(r.comparisons) ? (r.comparisons as number) : 0,
      score: ratingToScore(bucket, rating),
      ranked_at: typeof r.ranked_at === 'string' ? r.ranked_at : new Date().toISOString(),
    }
  })

  const watched: Watched[] = (Array.isArray(data.watched) ? data.watched : []).map((w, i) => {
    if (!isObj(w) || !num(w.tmdb_show_id) || !num(w.season) || !num(w.number)) throw new Error(`Watched episode #${i + 1} is invalid.`)
    const [showId, season, number] = [w.tmdb_show_id as number, w.season as number, w.number as number]
    return {
      id: episodeKey(showId, season, number),
      tmdb_show_id: showId,
      season,
      number,
      watched_at: typeof w.watched_at === 'string' ? w.watched_at : new Date().toISOString(),
    }
  })

  return {
    app: 'show-tracker',
    version: 4,
    exported_at: strOrNull(data.exported_at) ?? '',
    shows,
    episodes,
    rankings,
    watched,
    settings: parseSettings(data.settings),
  }
}

const ON_AIR_FILTERS: OnAirFilter[] = ['all', 'caughtUp']
const TRACKING_VIEWS: TrackingView[] = ['watching', 'onair']
const THEMES: ThemePref[] = ['system', 'light', 'dark']

/** Only well-formed settings are kept; anything else stays as it is on this phone. */
function parseSettings(v: unknown): BackupSettings {
  if (!isObj(v)) return {}
  const out: BackupSettings = {}
  if (typeof v.region === 'string' && /^([A-Z]{2})?$/.test(v.region)) out.region = v.region
  if (Array.isArray(v.services)) {
    out.services = []
    for (const p of v.services) {
      if (isObj(p) && num(p.id) && typeof p.name === 'string') {
        out.services.push({ id: p.id as number, name: p.name, logo_path: strOrNull(p.logo_path) })
      }
    }
  }
  if (ON_AIR_FILTERS.includes(v.onAirFilter as OnAirFilter)) out.onAirFilter = v.onAirFilter as OnAirFilter
  if (TRACKING_VIEWS.includes(v.trackingView as TrackingView)) out.trackingView = v.trackingView as TrackingView
  if (QUESTION_OPTIONS.includes(v.rankingQuestions as QuestionSetting)) out.rankingQuestions = v.rankingQuestions as QuestionSetting
  if (THEMES.includes(v.theme as ThemePref)) out.theme = v.theme as ThemePref
  return out
}

/** Replace everything on this device with the backup's contents. */
export async function restoreBackup(backup: BackupFile) {
  await db.transaction('rw', [db.shows, db.episodes, db.rankings, db.watched], async () => {
    await Promise.all([db.shows.clear(), db.episodes.clear(), db.rankings.clear(), db.watched.clear()])
    await db.shows.bulkPut(backup.shows)
    await db.episodes.bulkPut(backup.episodes)
    await db.rankings.bulkPut(backup.rankings)
    await db.watched.bulkPut(backup.watched)
  })
}
