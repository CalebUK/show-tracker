import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshIcon, Spinner } from './Icons'

const THRESHOLD = 64
const MAX = 96

/**
 * Pull down from the top of the page to refresh. Standalone PWAs on iPhone have no
 * built-in pull-to-refresh, and the native one on Android is disabled in CSS so it
 * doesn't reload the whole app.
 */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<void>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const state = useRef({ startY: null as number | null, pull: 0, busy: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const s = state.current
    const set = (v: number) => {
      s.pull = v
      setPull(v)
    }
    const onStart = (e: TouchEvent) => {
      s.startY = window.scrollY <= 0 && !s.busy ? e.touches[0].clientY : null
    }
    const onMove = (e: TouchEvent) => {
      if (s.startY == null) return
      const dy = e.touches[0].clientY - s.startY
      set(dy > 0 && window.scrollY <= 0 ? Math.min(dy * 0.5, MAX) : 0)
    }
    const onEnd = () => {
      if (s.startY == null) return
      s.startY = null
      if (s.pull >= THRESHOLD) {
        s.busy = true
        setBusy(true)
        onRefresh().finally(() => {
          s.busy = false
          setBusy(false)
        })
      }
      set(0)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [onRefresh])

  const height = busy ? 48 : pull
  return (
    <div ref={ref}>
      <div
        className={`flex items-center justify-center overflow-hidden text-neutral-400 ${pull === 0 ? 'transition-[height] duration-200' : ''}`}
        style={{ height }}
      >
        {busy ? (
          <Spinner />
        ) : (
          <RefreshIcon
            width={20}
            height={20}
            style={{ transform: `rotate(${(pull / THRESHOLD) * 180}deg)`, opacity: Math.min(pull / THRESHOLD, 1) }}
          />
        )}
      </div>
      {children}
    </div>
  )
}
