import { db, setMeta, type Bucket, type Episode, type Ranking, type Show } from '../db'
import { scoreFor } from './ranking'

export interface BackupFile {
  app: 'show-tracker'
  version: 1
  exported_at: string
  shows: Show[]
  episodes: Episode[]
  rankings: Ranking[]
}

export async function buildBackup(): Promise<File> {
  const [shows, episodes, rankings] = await Promise.all([db.shows.toArray(), db.episodes.toArray(), db.rankings.toArray()])
  const backup: BackupFile = { app: 'show-tracker', version: 1, exported_at: new Date().toISOString(), shows, episodes, rankings }
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return new File([JSON.stringify(backup, null, 2)], `show-tracker-backup-${stamp}.json`, { type: 'application/json' })
}

export type SaveResult = 'shared' | 'downloaded' | 'cancelled' | 'needs-tap'

/**
 * Use the share sheet where it can take files (so it can go to iCloud Drive / Google Drive),
 * otherwise fall back to a download. Safari may refuse to share if too much time passed since
 * the tap; in that case the caller shows a button to try again with the prepared file.
 */
export async function saveFile(file: File): Promise<SaveResult> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      await markBackedUp()
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      if (err instanceof DOMException && err.name === 'NotAllowedError') return 'needs-tap'
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
  if (data.version !== 1) throw new Error(`Unsupported backup version: ${String(data.version)}`)
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
      streaming: Array.isArray(s.streaming) ? (s.streaming as Show['streaming']) : [],
      first_air_year: strOrNull(s.first_air_year),
      followed: s.followed === true,
      followed_at: strOrNull(s.followed_at),
      last_refreshed_at: strOrNull(s.last_refreshed_at),
      own_dvd: s.own_dvd === true,
      own_streaming: s.own_streaming === true,
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
    }
  })

  const rankings: Ranking[] = data.rankings.map((r, i) => {
    if (!isObj(r) || !num(r.tmdb_show_id) || !BUCKETS.includes(r.bucket as Bucket) || !num(r.position)) {
      throw new Error(`Ranking #${i + 1} is invalid.`)
    }
    if (!showIds.has(r.tmdb_show_id as number)) throw new Error(`Ranking #${i + 1} refers to a show that isn't in the backup.`)
    return {
      tmdb_show_id: r.tmdb_show_id as number,
      bucket: r.bucket as Bucket,
      position: r.position as number,
      score: num(r.score) ? (r.score as number) : 0,
      ranked_at: typeof r.ranked_at === 'string' ? r.ranked_at : new Date().toISOString(),
    }
  })

  return { app: 'show-tracker', version: 1, exported_at: strOrNull(data.exported_at) ?? '', shows, episodes, rankings }
}

/** Positions are the source of truth; renumber them 0..n-1 per bucket and recompute scores. */
export function normalizeRankings(rankings: Ranking[]): Ranking[] {
  return BUCKETS.flatMap((bucket) => {
    const list = rankings.filter((r) => r.bucket === bucket).sort((a, b) => a.position - b.position)
    return list.map((r, position) => ({ ...r, position, score: scoreFor(bucket, position, list.length) }))
  })
}

/** Replace everything on this device with the backup's contents. */
export async function restoreBackup(backup: BackupFile) {
  await db.transaction('rw', db.shows, db.episodes, db.rankings, async () => {
    await Promise.all([db.shows.clear(), db.episodes.clear(), db.rankings.clear()])
    await db.shows.bulkPut(backup.shows)
    await db.episodes.bulkPut(backup.episodes)
    await db.rankings.bulkPut(normalizeRankings(backup.rankings))
  })
}
