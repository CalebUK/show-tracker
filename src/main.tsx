import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { requestPersistentStorage } from './lib/install'
import { loadRegion, loadTmdbKey } from './lib/tmdb'
import { applyTheme } from './lib/theme'
import { App } from './App'
import './index.css'

registerSW({ immediate: true })
requestPersistentStorage()
applyTheme()

// Load per-phone settings first so Search doesn't flash the "add a key" prompt.
Promise.all([loadTmdbKey(), loadRegion()])
  .catch(() => {})
  .finally(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
