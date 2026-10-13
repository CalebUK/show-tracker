import type { ReactNode } from 'react'
import { BackIcon, PlayIcon, RankIcon, SearchIcon, SettingsIcon, TvIcon } from './Icons'
import { goBack, navigate, type Tab } from '../lib/router'
import { toastStore } from '../lib/toast'
import { isIOS, isStandalone } from '../lib/install'

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

const TABS: { id: Tab; label: string; path: string; Icon: typeof TvIcon }[] = [
  { id: 'tracking', label: 'Tracking', path: '/', Icon: PlayIcon },
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

/** A row of filter chips, used under screen titles. Wraps rather than scrolling sideways. `value` null = none selected. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; count?: number }[]
  value: T | null
  onChange: (id: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5 px-5 pb-3">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`h-8 shrink-0 rounded-full px-2.5 text-[13px] font-medium transition ${
            value === o.id
              ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
              : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
          }`}
        >
          {o.label}
          {o.count ? <span className="ml-1 opacity-60">{o.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/**
 * iPhone only, in a browser tab: Home Screen web apps get their own storage, separate from
 * Safari, so anything added here won't show up in the installed app.
 */
export function IosInstallNote({ className = '' }: { className?: string }) {
  if (!isIOS() || isStandalone()) return null
  return (
    <div className={`rounded-xl bg-neutral-50 p-3 text-sm leading-relaxed text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300 ${className}`}>
      <span className="font-medium text-neutral-900 dark:text-neutral-100">Add to Home Screen first.</span> Tap Share, then Add
      to Home Screen, and use the app from there. On iPhone, shows added in the browser won't carry over to the Home Screen
      app.
    </div>
  )
}

/** A pop-up that slides up from the bottom. Tapping outside it closes it. */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        className="pb-safe animate-slide-in w-full max-w-xl rounded-t-2xl bg-white px-5 pt-5 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pb-5">{children}</div>
      </div>
    </div>
  )
}

/** An on/off switch, styled like the native ones on iOS and Android. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-accent' : 'bg-neutral-200 dark:bg-neutral-700'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
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
  size = 'md',
  disabled,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  type?: 'button' | 'submit'
  /** `sm` is a smaller pill shape for tight spots, like beside a poster. */
  size?: 'md' | 'sm'
  disabled?: boolean
  className?: string
}) {
  const styles = {
    primary: 'bg-accent text-white active:opacity-80',
    secondary: 'bg-neutral-100 text-neutral-900 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:active:bg-neutral-700',
    ghost: 'text-accent-text active:opacity-60',
  }[variant]
  const sizing = size === 'sm' ? 'h-9 gap-1.5 rounded-full px-3 text-sm' : 'h-11 gap-2 rounded-xl px-5 text-[15px]'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center font-medium transition disabled:opacity-50 ${sizing} ${styles} ${className}`}
    >
      {children}
    </button>
  )
}
