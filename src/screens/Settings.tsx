import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getMeta } from '../db'
import { buildBackup, parseBackup, restoreBackup, saveFile, type BackupFile } from '../lib/backup'
import { installPrompt, isIOS, isStandalone } from '../lib/install'
import { timeAgo } from '../lib/dates'
import { refreshFollowed } from '../lib/shows'
import { errorMessage, toast } from '../lib/toast'
import { Button, ScreenHeader } from '../components/Layout'

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

        <InstallSection />
        <StorageSection />

        <Section title="About">
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
