import { getMeta, setMeta } from '../db'
import type { Progress } from './progress'
import { createStore } from './store'

/**
 * Which shows appear under Tracking → On air (Settings → On air):
 * every show, or only ones you're on the current season of (so season 3 doesn't show while
 * you're still on season 1). Included in backups.
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
 * Up to the current season, for On air purposes: your next episode is in the season that's
 * airing (or the latest one), so being a few episodes behind is fine but a whole season isn't.
 * The current season goes by episodes aired before today, so a premiere doesn't make a show
 * vanish on the day.
 */
export const isOnCurrentSeason = ({ next, currentSeason }: Progress) =>
  !next || currentSeason == null || next.season >= currentSeason
