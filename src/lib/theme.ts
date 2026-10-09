import { createStore } from './store'

export type ThemePref = 'system' | 'light' | 'dark'

/**
 * Kept in localStorage (not IndexedDB) so the inline script in index.html can apply it
 * before the first paint. It's a per-phone display preference, so it isn't backed up.
 */
const KEY = 'theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function readPref(): ThemePref {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export const themeStore = createStore<ThemePref>(readPref())

export function applyTheme(pref: ThemePref = themeStore.get()) {
  const dark = pref === 'dark' || (pref === 'system' && media.matches)
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  // Status bar / browser chrome colour follows the app's theme, not just the system's.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', dark ? '#0a0a0a' : '#ffffff')
  }
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    // Storage blocked: the choice applies until the app is closed.
  }
  themeStore.set(pref)
  applyTheme(pref)
}

media.addEventListener('change', () => applyTheme())
