import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getMeta } from '../db'
import { buildBackup, parseBackup, restoreBackup, saveFile, type BackupFile } from '../lib/backup'
import { installPrompt, isIOS, isStandalone } from '../lib/install'
import { timeAgo } from '../lib/dates'
import { refreshFollowed } from '../lib/shows'
import { errorMessage, toast } from '../lib/toast'
import {
  DEV_KEY,
  detectedRegion,
  getStreamingRegions,
  regionName,
  regionStore,
  removeTmdbKey,
  setRegion,
  tmdbKeyStore,
  useTmdbKey,
} from '../lib/tmdb'
import { Button, ScreenHeader } from '../components/Layout'
import { CoffeeIcon } from '../components/Icons'
import { setThemePref, themeStore, type ThemePref } from '../lib/theme'
import { TmdbKeyForm, TmdbKeyHelp } from '../components/TmdbKeyForm'

const REMIND_AFTER_DAYS = 14

export function Settings() {
  const counts = useLiveQuery(async () => ({
    shows: await db.shows.count(),
    followed: (await db.shows.toArray()).filter((s) => s.followed).length,
    rankings: await db.rankings.count(),
  }))
  const lastBackupAt = useLiveQuery(() => getMeta<string>('lastBackupAt').then((v) => v ?? null))

  const [prepared, setPrepared] = useState<File | null>(null)
  const [pending, setPending] = useState<BackupFile | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const handleSave = async (file: File) => {
    const result = await saveFile(file)
    if (result === 'needs-tap') setPrepared(file)
    else {
      setPrepared(null)
      if (result !== 'cancelled') toast('Backup saved')
    }
  }

  const exportBackup = async () => {
    setBusy(true)
    try {
      await handleSave(await buildBackup())
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setPending(parseBackup(await file.text()))
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  const confirmImport = async () => {
    if (!pending) return
    setBusy(true)
    try {
      await restoreBackup(pending)
      setPending(null)
      toast('Backup restored')
      refreshFollowed({ force: true })
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const daysSinceBackup = lastBackupAt ? (Date.now() - Date.parse(lastBackupAt)) / 86_400_000 : Infinity
  const hasData = (counts?.shows ?? 0) > 0
  const remind = hasData && daysSinceBackup > REMIND_AFTER_DAYS

  return (
    <>
      <ScreenHeader title="Settings" />
      <div className="space-y-8 px-5 pt-2 pb-10">
        <Section title="Backup">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Everything is stored only on this phone. Export a backup now and then and keep it in iCloud Drive or Google Drive.
          </p>
          <p className={`mt-3 text-sm ${remind ? 'text-accent-text' : 'text-neutral-500 dark:text-neutral-400'}`}>
            {lastBackupAt ? `Last backup ${timeAgo(lastBackupAt)}.` : 'No backup yet.'}
            {remind && ' Worth making a new one.'}
          </p>
          {counts && (
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {counts.followed} followed · {counts.rankings} ranked
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button onClick={exportBackup} disabled={busy || !hasData}>
              Export backup
            </Button>
            <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
              Import backup
            </Button>
          </div>
          <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={onPickFile} />

          {prepared && (
            <div className="mt-4 rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900">
              <p className="text-sm">Your backup is ready.</p>
              <Button className="mt-3 w-full" onClick={() => handleSave(prepared)}>
                Save {prepared.name}
              </Button>
            </div>
          )}

          {pending && (
            <div className="mt-4 rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900">
              <p className="text-[15px] font-medium">Replace everything on this phone?</p>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                The backup{pending.exported_at ? ` from ${new Date(pending.exported_at).toLocaleDateString()}` : ''} has{' '}
                {pending.shows.filter((s) => s.followed).length} followed and {pending.rankings.length} ranked shows.
                {counts && ` Your current ${counts.followed} followed and ${counts.rankings} ranked shows will be replaced.`}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={confirmImport} disabled={busy}>
                  Replace
                </Button>
              </div>
            </div>
          )}
        </Section>

        <TmdbKeySection />
        <RegionSection />
        <AppearanceSection />
        <InstallSection />
        <StorageSection />

        <Section title="About">
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="text-[15px]">Made by 16bithill</p>
            <a
              href="https://buymeacoffee.com/calebhill"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-neutral-100 px-3.5 text-sm font-medium text-neutral-900 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:active:bg-neutral-700"
            >
              <CoffeeIcon width={18} height={18} />
              Buy me a coffee
            </a>
          </div>
          <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
            This product uses the TMDB API but is not endorsed or certified by TMDB.{' '}
            <a className="text-accent-text" href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">
              themoviedb.org
            </a>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
            Episode schedules from{' '}
            <a className="text-accent-text" href="https://www.tvmaze.com/" target="_blank" rel="noreferrer">
              TVmaze
            </a>{' '}
            (CC BY-SA). Streaming availability from JustWatch via TMDB.
          </p>
        </Section>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{title}</h2>
      {children}
    </section>
  )
}

function TmdbKeySection() {
  const stored = tmdbKeyStore.use()
  const [editing, setEditing] = useState(false)

  const remove = async () => {
    if (!window.confirm('Remove the TMDB key from this phone? Search and refresh will stop until you add one again.')) return
    await removeTmdbKey()
    toast('TMDB key removed')
  }

  return (
    <Section title="TMDB key">
      {stored && !editing ? (
        <>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Saved on this phone, ending in <span className="font-mono text-neutral-700 dark:text-neutral-300">{stored.slice(-4)}</span>.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Change
            </Button>
            <Button variant="secondary" onClick={remove}>
              Remove
            </Button>
          </div>
        </>
      ) : (
        <>
          <TmdbKeyHelp />
          {!stored && DEV_KEY && (
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              Using the key from <code className="text-[13px]">.env</code> for now (development builds only).
            </p>
          )}
          <TmdbKeyForm onSaved={() => setEditing(false)} onCancel={editing ? () => setEditing(false) : undefined} />
        </>
      )}
    </Section>
  )
}

// Shown if TMDB's full region list can't be loaded (no key yet, or offline).
const FALLBACK_REGIONS = ['US', 'GB', 'CA', 'AU', 'IE', 'NZ']

function RegionSection() {
  const stored = regionStore.use()
  const tmdbKey = useTmdbKey()
  const [regions, setRegions] = useState<{ code: string; name: string }[] | null>(null)
  const detected = detectedRegion()

  useEffect(() => {
    if (!tmdbKey) return
    getStreamingRegions().then(setRegions, () => setRegions(null))
  }, [tmdbKey])

  const options = regions ?? FALLBACK_REGIONS.map((code) => ({ code, name: regionName(code) }))
  if (stored && !options.some((o) => o.code === stored)) options.unshift({ code: stored, name: regionName(stored) })

  const change = async (code: string) => {
    await setRegion(code)
    toast(`Streaming region: ${regionName(code || detected)}`)
    refreshFollowed({ force: true })
  }

  return (
    <Section title="Streaming region">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Which services a show is on depends on the country. This only affects this phone.
      </p>
      <select
        value={stored}
        onChange={(e) => change(e.target.value)}
        aria-label="Streaming region"
        className="mt-3 h-11 w-full rounded-xl bg-neutral-100 px-3 text-base text-neutral-900 outline-none focus:ring-2 focus:ring-accent dark:bg-neutral-800 dark:text-neutral-100"
      >
        <option value="">Automatic ({regionName(detected)})</option>
        {options.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name}
          </option>
        ))}
      </select>
    </Section>
  )
}

const THEMES: { id: ThemePref; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

function AppearanceSection() {
  const pref = themeStore.use()
  return (
    <Section title="Appearance">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={pref === t.id}
            onClick={() => setThemePref(t.id)}
            className={`h-9 rounded-lg text-sm font-medium transition ${
              pref === t.id
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-950 dark:text-neutral-100'
                : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </Section>
  )
}

function InstallSection() {
  const prompt = installPrompt.use()
  if (isStandalone()) return null
  return (
    <Section title="Install">
      {prompt ? (
        <Button
          variant="secondary"
          onClick={async () => {
            await prompt.prompt()
            installPrompt.set(null)
          }}
        >
          Install app
        </Button>
      ) : (
        <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          {isIOS()
            ? 'In Safari, tap Share, then Add to Home Screen.'
            : 'In Chrome, open the menu and choose Install app (or Add to Home screen).'}
        </p>
      )}
    </Section>
  )
}

function StorageSection() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null))
  }, [])
  if (persisted === null) return null
  return (
    <Section title="Storage">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        {persisted
          ? 'Persistent storage is on, so the browser won’t clear your data to save space.'
          : 'The browser may clear data under storage pressure. Installing the app to the home screen usually helps; backups are the safety net.'}
      </p>
    </Section>
  )
}
