import { Component, type ReactNode } from 'react'
import { buildBackup, saveFile } from '../lib/backup'

/**
 * If anything throws while drawing the app, show a recovery screen instead of a blank page:
 * reload, or export a backup first (the data lives only on this phone).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; exportNote: string | null }> {
  state = { error: null as Error | null, exportNote: null as string | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Show Tracker crashed:', error)
  }

  exportBackup = async () => {
    try {
      const result = await saveFile(await buildBackup())
      this.setState({ exportNote: result === 'cancelled' ? null : 'Backup saved.' })
    } catch {
      this.setState({ exportNote: "Couldn't export a backup." })
    }
  }

  render() {
    const { error, exportNote } = this.state
    if (!error) return this.props.children
    return (
      <div className="pt-safe flex min-h-screen flex-col items-center justify-center px-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          Your shows and rankings are still saved on this phone. Try reloading. If it keeps happening, export a backup to be safe.
        </p>
        <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
          <button onClick={() => location.reload()} className="h-11 rounded-xl bg-accent text-[15px] font-medium text-white active:opacity-80">
            Reload
          </button>
          <button
            onClick={this.exportBackup}
            className="h-11 rounded-xl bg-neutral-100 text-[15px] font-medium text-neutral-900 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100"
          >
            Export backup
          </button>
        </div>
        {exportNote && <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">{exportNote}</p>}
        <p className="mt-8 max-w-sm font-mono text-xs break-words text-neutral-400">{error.message}</p>
      </div>
    )
  }
}
