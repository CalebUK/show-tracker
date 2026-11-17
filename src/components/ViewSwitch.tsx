import { useRef, useState, type ReactNode, type TouchEvent } from 'react'

type Side = 'left' | 'right'
type SwipeHandlers = { onTouchStart: (e: TouchEvent) => void; onTouchEnd: (e: TouchEvent) => void }

/**
 * A tab's views, switched from its title: the chosen one big, the others small, swapping sizes as
 * you tap. Tracking (Watching / On air) and Rankings (Rankings / Suggestions).
 */
export function ViewSwitch<T extends string>({
  views,
  value,
  onChange,
}: {
  views: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <h1 className="flex min-w-0 items-baseline gap-3">
      {views.map((v) => (
        <button
          key={v.id}
          onClick={() => onChange(v.id)}
          aria-pressed={value === v.id}
          className={`font-semibold tracking-tight whitespace-nowrap transition-all duration-300 ease-out ${
            value === v.id ? 'text-2xl text-neutral-900 dark:text-neutral-100' : 'text-base text-neutral-400 active:text-neutral-600 dark:text-neutral-500'
          }`}
        >
          {v.label}
        </button>
      ))}
    </h1>
  )
}

/**
 * State for a ViewSwitch: the view, which side a newly chosen one slides in from (later views from
 * the right), and swipe handlers that flip to the next or previous view.
 */
export function useViewSwitch<T extends string>(ids: readonly T[], initial: T, remember: (v: T) => void) {
  const [view, setViewState] = useState(initial)
  const [from, setFrom] = useState<Side | null>(null)
  const setView = (v: T) => {
    if (v === view) return
    setFrom(ids.indexOf(v) > ids.indexOf(view) ? 'right' : 'left')
    remember(v)
    setViewState(v)
    window.scrollTo(0, 0)
  }
  const swipe = useSwipe((direction) => {
    const next = ids[ids.indexOf(view) + (direction === 'left' ? 1 : -1)]
    if (next) setView(next)
  })
  return { view, setView, from, swipe }
}

/**
 * The content under a ViewSwitch. The inner part remounts on each switch so it slides in; the
 * outer one clips it sideways, so the slide doesn't flash scroll bars.
 */
export function SwitchedView({ view, from, swipe, children }: { view: string; from: Side | null; swipe: SwipeHandlers; children: ReactNode }) {
  return (
    <div {...swipe} className="min-h-[60vh] overflow-x-clip">
      <div key={view} className={from === 'right' ? 'motion-safe:animate-from-right' : from === 'left' ? 'motion-safe:animate-from-left' : ''}>
        {children}
      </div>
    </div>
  )
}

/** A sideways swipe flips the view. Ignored on rows that scroll sideways themselves (data-no-swipe). */
function useSwipe(onSwipe: (direction: Side) => void): SwipeHandlers {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (e) => {
      const t = e.touches[0]
      start.current = (e.target as Element).closest('[data-no-swipe]') ? null : { x: t.clientX, y: t.clientY }
    },
    onTouchEnd: (e) => {
      const s = start.current
      start.current = null
      if (!s) return
      const t = e.changedTouches[0]
      const [dx, dy] = [t.clientX - s.x, t.clientY - s.y]
      if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) onSwipe(dx < 0 ? 'left' : 'right')
    },
  }
}
