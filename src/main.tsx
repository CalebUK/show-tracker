import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { requestPersistentStorage } from './lib/install'
import { loadRegion, loadTmdbKey } from './lib/tmdb'
import { applyTheme } from './lib/theme'
import { loadQuestionSetting } from './lib/ranking'
import { loadOnAirFilter } from './lib/onAir'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

registerSW({ immediate: true })
requestPersistentStorage()
applyTheme()
// The old image cache held opaque responses that inflate storage use; it's been replaced by tmdb-images-v2.
if ('caches' in window) caches.delete('tmdb-images').catch(() => {})

// Load per-phone settings first so Search doesn't flash the "add a key" prompt.
Promise.all([loadTmdbKey(), loadRegion(), loadQuestionSetting(), loadOnAirFilter()])
  .catch(() => {})
  .finally(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    ),
  )
