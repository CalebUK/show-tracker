import { getMeta, setMeta } from '../db'
import { createStore } from './store'

/** Which view the Tracking tab opens on (Settings → Tracking opens on). Stored per phone; not part of backups. */
export type TrackingView = 'watching' | 'onair'

export const defaultViewStore = createStore<TrackingView>('watching')

export async function loadDefaultView() {
  const saved = await getMeta<TrackingView>('trackingView')
  if (saved === 'watching' || saved === 'onair') defaultViewStore.set(saved)
}

export async function setDefaultView(value: TrackingView) {
  await setMeta('trackingView', value)
  defaultViewStore.set(value)
}
