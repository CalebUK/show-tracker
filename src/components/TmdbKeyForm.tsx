import { useState, type FormEvent } from 'react'
import { saveTmdbKey } from '../lib/tmdb'
import { refreshFollowed } from '../lib/shows'
import { errorMessage, toast } from '../lib/toast'
import { Button } from './Layout'

export function TmdbKeyHelp() {
  return (
    <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
      Show info comes from TMDB, which needs a free API token. Make a TMDB account, request API access under{' '}
      <a className="text-accent-text" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
        Settings → API
      </a>
      , then copy the long <span className="font-medium text-neutral-700 dark:text-neutral-200">API Read Access Token</span> (not
      the shorter API Key). It's kept only on this phone and isn't included in backups.
    </p>
  )
}

/** Paste a TMDB key; it's checked with TMDB before being saved on this device. */
export function TmdbKeyForm({ onSaved, onCancel }: { onSaved?: () => void; onCancel?: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await saveTmdbKey(value)
      setValue('')
      toast('TMDB token saved')
      refreshFollowed()
      onSaved?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="mt-4">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste your API Read Access Token"
        aria-label="TMDB key"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="h-11 w-full rounded-xl bg-neutral-100 px-3 font-mono text-base text-neutral-900 outline-none placeholder:font-sans placeholder:text-neutral-400 focus:ring-2 focus:ring-accent dark:bg-neutral-800 dark:text-neutral-100"
      />
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className={`mt-3 grid gap-3 ${onCancel ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={busy || !value.trim()}>
          {busy ? 'Checking…' : 'Save key'}
        </Button>
      </div>
    </form>
  )
}
