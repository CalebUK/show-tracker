import { db, getMeta, setMeta, type Show } from '../db'
import { createStore } from './store'

/**
 * Someone you track shows for besides yourself (Settings → People). A show tagged with them stays
 * in Tracking with their name, is kept out of rating, and only counts in Your stats if `inStats`
 * is on. Included in backups.
 */
export interface Person {
  id: string
  name: string
  inStats: boolean
}

export const peopleStore = createStore<Person[]>([])

export const MAX_NAME = 30

export async function loadPeople() {
  const saved = await getMeta<Person[]>('people')
  if (Array.isArray(saved)) peopleStore.set(saved)
}

export async function setPeople(list: Person[]) {
  await setMeta('people', list)
  peopleStore.set(list)
}

const newId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

/** Throws a readable error if the name is empty or already taken (ignoring case). */
function checkName(name: string, exceptId?: string) {
  const trimmed = name.trim().slice(0, MAX_NAME)
  if (!trimmed) throw new Error('Enter a name.')
  if (peopleStore.get().some((p) => p.id !== exceptId && p.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`${trimmed} is already on the list.`)
  }
  return trimmed
}

export async function addPerson(name: string) {
  await setPeople([...peopleStore.get(), { id: newId(), name: checkName(name), inStats: false }])
}

export async function renamePerson(id: string, name: string) {
  const trimmed = checkName(name, id)
  await setPeople(peopleStore.get().map((p) => (p.id === id ? { ...p, name: trimmed } : p)))
}

export async function setPersonInStats(id: string, inStats: boolean) {
  await setPeople(peopleStore.get().map((p) => (p.id === id ? { ...p, inStats } : p)))
}

/** Take someone off the list. Their shows go back to you. */
export async function removePerson(id: string) {
  await db.shows.toCollection().modify((s: Show) => {
    if (s.person === id) delete s.person
  })
  await setPeople(peopleStore.get().filter((p) => p.id !== id))
}

/** Who a show is for: one of your people, or null if it's yours (including a tag for someone no longer listed). */
export const personFor = (show: Show, people: Person[]) => (show.person ? (people.find((p) => p.id === show.person) ?? null) : null)

/** Your own shows count in Your stats, and so do those of people with "In my stats" on. */
export function countsInStats(show: Show, people: Person[]) {
  const person = personFor(show, people)
  return !person || person.inStats
}
