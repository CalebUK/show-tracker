import type { BackupSettings } from './backup'
import { onAirFilterStore, setOnAirFilter } from './onAir'
import { questionsStore, setQuestionSetting } from './ranking'
import { myServicesStore, setMyServices } from './services'
import { setThemePref, themeStore } from './theme'
import { regionStore, setRegion } from './tmdb'
import { defaultViewStore, setDefaultView } from './trackingView'

/** This phone's settings, for a backup. The TMDB token is never included. */
export const currentSettings = (): BackupSettings => ({
  region: regionStore.get(),
  services: myServicesStore.get(),
  onAirFilter: onAirFilterStore.get(),
  trackingView: defaultViewStore.get(),
  rankingQuestions: questionsStore.get(),
  theme: themeStore.get(),
})

/** Apply the settings from a backup. Any it doesn't have (older backups) stay as they are. */
export async function applySettings(s: BackupSettings) {
  if (s.region !== undefined) await setRegion(s.region)
  if (s.services) await setMyServices(s.services)
  if (s.onAirFilter) await setOnAirFilter(s.onAirFilter)
  if (s.trackingView) await setDefaultView(s.trackingView)
  if (s.rankingQuestions) await setQuestionSetting(s.rankingQuestions)
  if (s.theme) setThemePref(s.theme)
}
