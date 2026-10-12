import { getMeta, setMeta } from '../db'
import type { Progress } from './progress'
import { createStore } from './store'

/**
 * Which shows appear under Tracking → On air (Settings → On air):
 * every show, or only ones you're caught up on (so season 3's premiere doesn't show while
 * you're still on season 1). Stored per phone; not part of backups.
 */
export type OnAirFilter = 'all' | 'caughtUp'

export const onAirFilterStore = createStore<OnAirFilter>('all')

export async function loadOnAirFilter() {
  const saved = await getMeta<OnAirFilter>('onAirFilter')
  if (saved === 'all' || saved === 'caughtUp') onAirFilterStore.set(saved)
}

export async function setOnAirFilter(value: OnAirFilter) {
  await setMeta('onAirFilter', value)
  onAirFilterStore.set(value)
}

/**
 * Caught up for On air purposes: nothing that aired before today is left to watch. An episode
 * airing today doesn't count against you, so a show you watch live stays put on the day.
 */
export const isCaughtUpForOnAir = (progress: Progress, todayIso: string) => !progress.next || progress.next.airstamp >= todayIso
