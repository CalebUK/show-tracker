import type { ReactNode } from 'react'
import { BackIcon, CalendarIcon, RankIcon, SearchIcon, SettingsIcon, TvIcon } from './Icons'
import { goBack, navigate, type Tab } from '../lib/router'
import { toastStore } from '../lib/toast'

/** Sticky title bar for a tab screen. */
export function ScreenHeader({ title, right, children }: { title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <header className="pt-safe sticky top-0 z-10 bg-white/85 backdrop-blur-md dark:bg-neutral-950/85">
      <div className="flex h-14 items-center justify-between px-5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="flex items-center gap-1">{right}</div>
      </div>
      {children}
    </header>
  )
}

const TABS: { id: Tab; label: string; path: string; Icon: typeof CalendarIcon }[] = [
  { id: 'upcoming', label: 'Upcoming', path: '/', Icon: CalendarIcon },
  { id: 'shows', label: 'Shows', path: '/shows', Icon: TvIcon },
  { id: 'rankings', label: 'Rankings', path: '/rankings', Icon: RankIcon },
  { id: 'search', label: 'Search', path: '/search', Icon: SearchIcon },
  { id: 'settings', label: 'Settings', path: '/settings', Icon: SettingsIcon },
]

export function TabBar({ active }: { active: Tab }) {
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200/70 bg-white/90 backdrop-blur-md dark:border-neutral-800/70 dark:bg-neutral-950/90">
      <div className="mx-auto flex max-w-xl">
        {TABS.map(({ id, label, path, Icon }) => (
          <button
            key={id}
            onClick={() => navigate(path, { replace: true })}
            className={`flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium ${
              active === id ? 'text-accent-text' : 'text-neutral-400 dark:text-neutral-500'
            }`}
            aria-current={active === id ? 'page' : undefined}
          >
            <Icon width={24} height={24} />
            {label}
          </button>
        ))}
      </div>
    </nav>
  )
}

/** A full-screen layer above the tabs (show detail, ranking flow). The screen beneath keeps its scroll position. */
export function Overlay({ title, children, fallback = '/' }: { title?: string; children: ReactNode; fallback?: string }) {
  return (
    <div className="animate-slide-in fixed inset-0 z-30 overflow-y-auto overscroll-contain bg-white dark:bg-neutral-950">
      <header className="pt-safe sticky top-0 z-10 bg-white/85 backdrop-blur-md dark:bg-neutral-950/85">
        <div className="mx-auto flex h-12 max-w-xl items-center px-2">
          <button onClick={() => goBack(fallback)} className="flex items-center gap-0.5 rounded-full p-2 text-accent-text" aria-label="Back">
            <BackIcon width={22} height={22} />
            <span className="text-base">Back</span>
          </button>
          {title && <div className="ml-2 truncate font-medium">{title}</div>}
        </div>
      </header>
      <div className="pb-safe mx-auto max-w-xl">{children}</div>
    </div>
  )
}

export function Toast() {
  const message = toastStore.use()
  if (!message) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-6" role="status">
      <div className="animate-slide-in rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900">
        {message}
      </div>
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-10 pt-24 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
}) {
  const styles = {
    primary: 'bg-accent text-white active:opacity-80',
    secondary: 'bg-neutral-100 text-neutral-900 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:active:bg-neutral-700',
    ghost: 'text-accent-text active:opacity-60',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-medium transition disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}
