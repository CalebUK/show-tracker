import { useSyncExternalStore } from 'react'

/** Tiny observable value for app-wide UI state (refresh status, toasts). */
export function createStore<T>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  const get = () => state
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }
  return {
    get,
    subscribe,
    set(next: T) {
      state = next
      listeners.forEach((l) => l())
    },
    use: () => useSyncExternalStore(subscribe, get),
  }
}
