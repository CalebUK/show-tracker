import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getMeta, type Provider } from '../db'
import { buildBackup, parseBackup, restoreBackup, saveFile, type BackupFile } from '../lib/backup'
import { applySettings, currentSettings } from '../lib/preferences'
import { installPrompt, isIOS, isStandalone } from '../lib/install'
import { formatDuration, timeAgo } from '../lib/dates'
import { useLibrary } from '../hooks/useLibrary'
import { isFinished } from '../lib/progress'
import { useNow } from '../hooks/useNow'
import { refreshFollowed } from '../lib/shows'
import { errorMessage, toast } from '../lib/toast'
import {
  DEV_KEY,
  isReadAccessToken,
  detectedRegion,
  getRegionServices,
  getStreamingRegions,
  logoUrl,
  regionName,
  regionStore,
  removeTmdbKey,
  setRegion,
  tmdbKeyStore,
  useRegion,
  useTmdbKey,
} from '../lib/tmdb'
import { Button, ScreenHeader } from '../components/Layout'
import { ChevronIcon, CoffeeIcon, Spinner } from '../components/Icons'
import { setThemePref, themeStore, type ThemePref } from '../lib/theme'
import { questionsStore, setQuestionSetting } from '../lib/ranking'
import { onAirFilterStore, setOnAirFilter } from '../lib/onAir'
import { defaultViewStore, setDefaultView } from '../lib/trackingView'
import { myServicesStore, sameService, servicesOnShows, setServiceTicked } from '../lib/services'
import { QUESTION_OPTIONS } from '../lib/elo'
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

  const handleSave = async (file: File, fromTap = false) => {
    const result = await saveFile(file, { share: isIOS(), fromTap })
    if (result === 'needs-tap') setPrepared(file)
    else {
      setPrepared(null)
      if (result === 'downloaded') toast('Backup saved to your Downloads folder')
      else if (result === 'shared') toast('Backup saved')
    }
  }

  const exportBackup = async () => {
    setBusy(true)
    try {
      await handleSave(await buildBackup(currentSettings()))
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
      await applySettings(pending.settings)
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
        <StatsSection />
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
              <Button className="mt-3 w-full" onClick={() => handleSave(prepared, true)}>
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
                {Object.keys(pending.settings).length > 0 && ' Your settings (region, streaming services and the rest) come back too.'}
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
        <ServicesSection />
        <OnAirSection />
        <TrackingViewSection />
        <RankingSection />
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
          {/* TMDB's terms require their logo, kept smaller than the app's own branding. */}
          <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" className="inline-block" aria-label="The Movie Database (TMDB)">
            <img src={`${import.meta.env.BASE_URL}tmdb-logo.svg`} alt="TMDB" className="h-3.5 w-auto" />
          </a>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
            This app uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
            Episode schedules from{' '}
            <a className="text-accent-text" href="https://www.tvmaze.com/" target="_blank" rel="noreferrer">
              TVmaze
            </a>{' '}
            (CC BY-SA). Streaming availability from JustWatch via TMDB.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
            Anonymous visit counts (which screens get opened) go to Vercel Analytics. No cookies, and nothing about your shows.
          </p>
        </Section>
      </div>
    </>
  )
}

/** Episodes watched and total time across every show, from ticks and episode runtimes. */
function StatsSection() {
  const library = useLibrary(useNow())
  if (!library) return null
  let episodes = 0
  let minutes = 0
  let finished = 0
  for (const show of library.shows) {
    const p = library.progress.get(show.tmdb_id)!
    episodes += p.watched
    minutes += p.minutesWatched ?? 0
    if (isFinished(show, p)) finished++
  }
  return (
    <Section title="Your stats">
      <div className="grid grid-cols-3 gap-2">
        <Stat value={episodes.toLocaleString()} label={episodes === 1 ? 'episode watched' : 'episodes watched'} />
        <Stat value={minutes ? formatDuration(minutes) : '0m'} label="time watched" />
        <Stat value={finished.toLocaleString()} label={finished === 1 ? 'show finished' : 'shows finished'} />
      </div>
    </Section>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-neutral-50 px-3 py-3 dark:bg-neutral-900">
      <div className="text-xl font-semibold tracking-tight whitespace-nowrap text-accent-text tabular-nums">{value}</div>
      <div className="text-xs leading-snug text-neutral-500 dark:text-neutral-400">{label}</div>
    </div>
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
    if (!window.confirm('Remove the TMDB token from this phone? Search and refresh will stop until you add one again.')) return
    await removeTmdbKey()
    toast('TMDB token removed')
  }

  return (
    <Section title="TMDB token">
      {stored && !editing ? (
        <>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Saved on this phone, ending in <span className="font-mono text-neutral-700 dark:text-neutral-300">{stored.slice(-4)}</span>.
          </p>
          {!isReadAccessToken(stored) && (
            <p className="mt-2 text-sm text-accent-text">
              This is the older, shorter API Key. Tap Change and paste your API Read Access Token instead: it's sent more
              privately.
            </p>
          )}
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

function ServicesSection() {
  const mine = myServicesStore.use()
  const regionCode = useRegion()
  const tmdbKey = useTmdbKey()
  const followed = useLiveQuery(() => db.shows.filter((s) => s.followed).toArray(), [])
  const [showMore, setShowMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [more, setMore] = useState<Provider[] | 'loading' | 'error'>('loading')

  // TMDB's full list for the region, fetched only when asked for.
  useEffect(() => {
    if (!showMore || !tmdbKey) return
    let cancelled = false
    setMore('loading')
    getRegionServices().then(
      (list) => !cancelled && setMore(list),
      () => !cancelled && setMore('error'),
    )
    return () => {
      cancelled = true
    }
  }, [showMore, tmdbKey, regionCode, attempt])

  if (!followed) return null
  const onShows = servicesOnShows(followed)
  // Ticked services that none of your shows are on stay listed, so they can be unticked.
  const extra = mine.filter((s) => !onShows.some((o) => sameService(o.service, s))).map((service) => ({ service, count: 0 }))
  const listed = [...onShows, ...extra]
  const others = Array.isArray(more) ? more.filter((p) => !listed.some((l) => sameService(l.service, p))) : []
  const ticked = (service: Provider) => mine.some((s) => sameService(s, service))
  const toggle = (service: Provider, value: boolean) => setServiceTicked(service, value).catch((err) => toast(errorMessage(err)))
  const note = 'mt-3 text-sm text-neutral-500 dark:text-neutral-400'

  return (
    <Section title="Streaming services">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Tick the ones you have. Shows → Able to stream then lists the shows you follow that are on them, plus any you own on DVD
        or streaming.
      </p>
      {listed.length > 0 ? (
        <ul className="mt-2">
          {listed.map(({ service, count }) => (
            <ServiceRow
              key={service.id}
              service={service}
              detail={count ? `${count} show${count === 1 ? '' : 's'}` : 'None of your shows'}
              checked={ticked(service)}
              onChange={toggle}
            />
          ))}
        </ul>
      ) : (
        <p className={note}>The services your shows are on will appear here once you follow some.</p>
      )}
      {!showMore ? (
        <button onClick={() => setShowMore(true)} className="mt-2 text-sm text-accent-text">
          More services in {regionName(regionCode)}
        </button>
      ) : !tmdbKey ? (
        <p className={note}>Add your TMDB token above to see every service.</p>
      ) : more === 'loading' ? (
        <div className="mt-3 flex justify-center text-neutral-400">
          <Spinner />
        </div>
      ) : more === 'error' ? (
        <p className={note}>
          Couldn't load the full list.{' '}
          <button onClick={() => setAttempt((n) => n + 1)} className="text-accent-text">
            Try again
          </button>
        </p>
      ) : (
        <>
          <h3 className="mt-4 text-xs font-medium text-neutral-500 dark:text-neutral-400">More in {regionName(regionCode)}</h3>
          <ul className="mt-1">
            {others.map((service) => (
              <ServiceRow key={service.id} service={service} checked={ticked(service)} onChange={toggle} />
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}

function ServiceRow({
  service,
  detail,
  checked,
  onChange,
}: {
  service: Provider
  detail?: string
  checked: boolean
  onChange: (service: Provider, value: boolean) => void
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 py-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(service, e.target.checked)}
          className="h-5 w-5 shrink-0 cursor-pointer accent-accent"
        />
        {service.logo_path ? (
          <img src={logoUrl(service.logo_path)!} alt="" crossOrigin="anonymous" className="h-7 w-7 shrink-0 rounded-lg" loading="lazy" />
        ) : (
          <span className="h-7 w-7 shrink-0 rounded-lg bg-neutral-100 dark:bg-neutral-800" />
        )}
        <span className="min-w-0 flex-1 truncate text-[15px]">{service.name}</span>
        {detail && <span className="shrink-0 text-sm text-neutral-400">{detail}</span>}
      </label>
    </li>
  )
}

function OnAirSection() {
  const filter = onAirFilterStore.use()
  return (
    <Section title="On air">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Which shows appear under Tracking → On air. With Current season, a show appears once you've reached the season
        that's airing: a few episodes behind is fine, but if you're still on season 2 while season 3 airs, it waits until
        you catch up.
      </p>
      <Segmented
        label="On air shows"
        options={[
          { id: 'all', label: 'All shows' },
          { id: 'caughtUp', label: 'Current season' },
        ]}
        value={filter}
        onChange={setOnAirFilter}
        className="mt-3"
      />
    </Section>
  )
}

function TrackingViewSection() {
  const view = defaultViewStore.use()
  return (
    <Section title="Tracking opens on">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">Which view you see first when you open the Tracking tab.</p>
      <Segmented
        label="Tracking opens on"
        options={[
          { id: 'watching', label: 'Watching' },
          { id: 'onair', label: 'On air' },
        ]}
        value={view}
        onChange={setDefaultView}
        className="mt-3"
      />
    </Section>
  )
}

function RankingSection() {
  const setting = questionsStore.use()
  const ranked = useLiveQuery(() => db.rankings.count()) ?? 0
  return (
    <Section title="Ranking">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Questions per ranking. More questions give a more precise score; All compares a new show against every show you've
        ranked{ranked > 0 ? ` (${ranked} right now)` : ''}.
      </p>
      <Segmented
        label="Questions per ranking"
        options={QUESTION_OPTIONS.map((q) => ({ id: q, label: q === 'all' ? 'All' : String(q) }))}
        value={setting}
        onChange={setQuestionSetting}
        className="mt-3"
      />
      <details className="group mt-4 rounded-xl bg-neutral-50 px-4 py-3 dark:bg-neutral-900">
        <summary className="flex cursor-pointer list-none items-center justify-between text-[15px] font-medium [&::-webkit-details-marker]:hidden">
          How rankings work
          <ChevronIcon width={18} height={18} className="text-neutral-400 transition group-open:rotate-90" />
        </summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
          <li>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">Pick how you felt.</span> Liked it (6.8–10), It was
            fine (3.4–6.7) or Didn't like it (0–3.3). The show starts in the middle of that range.
          </li>
          <li>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">Answer “Which was better?”</span> Each question
            uses the ranked show closest to its current score, so every answer counts. Too close to call is a draw.
          </li>
          <li>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">Scores shift with every answer.</span> It's an Elo
            rating, like in chess: the new show moves in big steps for its first 6 answers, then smaller ones, and the show it was
            compared with moves a little too.
          </li>
          <li>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">Scores stay in their bucket.</span> If your answers
            push a show past its range, you're asked whether to move it (for example from Fine up to Liked).
          </li>
          <li>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">Fine-tune any time.</span> Rank an already ranked
            show and tap Compare more to answer a few more questions, or pick a bucket to start it over.
          </li>
        </ol>
      </details>
    </Section>
  )
}

/** A row of mutually exclusive options, like the native segmented controls. */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className = '',
}: {
  label: string
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`grid gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`h-9 rounded-lg text-sm font-medium transition ${
            value === o.id
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-950 dark:text-neutral-100'
              : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
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
      <Segmented label="Theme" options={THEMES} value={pref} onChange={setThemePref} />
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
            ? 'In Safari, tap Share, then Add to Home Screen. Use the app from there: on iPhone, the Home Screen app keeps its own data, separate from Safari.'
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
