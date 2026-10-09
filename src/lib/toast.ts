import { createStore } from './store'

export const toastStore = createStore<string | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

export function toast(message: string) {
  toastStore.set(message)
  clearTimeout(timer)
  timer = setTimeout(() => toastStore.set(null), 3500)
}

export function errorMessage(err: unknown) {
  if (!navigator.onLine) return "You're offline."
  return err instanceof Error ? err.message : String(err)
}
