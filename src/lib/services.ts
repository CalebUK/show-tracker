import { getMeta, isOwned, setMeta, type Provider, type Show } from '../db'
import { createStore } from './store'

/** The streaming services you have (Settings → Streaming services), for Shows → Able to stream. Included in backups. */
export const myServicesStore = createStore<Provider[]>([])

export async function loadMyServices() {
  const saved = await getMeta<Provider[]>('myServices')
  if (Array.isArray(saved)) myServicesStore.set(saved)
}

/** Ticking adds the service; unticking removes it along with any variant of it you'd ticked. */
export async function setServiceTicked(service: Provider, ticked: boolean) {
  const rest = myServicesStore.get().filter((s) => !sameService(s, service))
  await setMyServices(ticked ? [...rest, { id: service.id, name: service.name, logo_path: service.logo_path }] : rest)
}

export async function setMyServices(list: Provider[]) {
  await setMeta('myServices', list)
  myServicesStore.set(list)
}

// "Disney+" and "Disney Plus" are the same service.
const norm = (name: string) => name.toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '')

/**
 * The same service, or one is a variant of the other: "Netflix" and "Netflix Standard with Ads",
 * "Acorn TV" and "AcornTV Amazon Channel". Very short names (Channel 5 is just "5") only match exactly.
 */
export function sameService(a: Provider, b: Provider) {
  if (a.id === b.id) return true
  const [x, y] = [norm(a.name), norm(b.name)].sort((p, q) => p.length - q.length)
  return x.length >= 3 ? y.startsWith(x) : x === y
}

/** Drops variants of a service that's also listed, keeping the main one. Order is kept. */
export function foldVariants(list: Provider[]) {
  return list.filter(
    (p, i) =>
      !list.some((q, j) => {
        if (j === i || !sameService(p, q)) return false
        const [a, b] = [norm(p.name).length, norm(q.name).length]
        return b < a || (b === a && j < i)
      }),
  )
}

/** Your services that a show is on. */
export const servicesFor = (show: Show, mine: Provider[]) =>
  mine.filter((s) => (show.streaming ?? []).some((p) => sameService(p, s)))

/** On one of your services, or you own it on DVD or streaming. */
export const canStream = (show: Show, mine: Provider[]) => isOwned(show) || servicesFor(show, mine).length > 0

/** Where you can watch a show: "Netflix · Own on DVD". */
export function whereToWatch(show: Show, mine: Provider[]) {
  return [
    ...servicesFor(show, mine).map((s) => s.name),
    show.own_streaming ? 'Own on streaming' : null,
    show.own_dvd ? 'Own on DVD' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The services some shows are on, variants folded in, with how many of the shows each is on. Most shows first. */
export function servicesOnShows(shows: Show[]): { service: Provider; count: number }[] {
  const byId = new Map<number, Provider>()
  for (const p of shows.flatMap((s) => s.streaming ?? [])) if (!byId.has(p.id)) byId.set(p.id, p)
  return foldVariants([...byId.values()])
    .map((service) => ({ service, count: shows.filter((s) => servicesFor(s, [service]).length > 0).length }))
    .sort((a, b) => b.count - a.count || a.service.name.localeCompare(b.service.name))
}
