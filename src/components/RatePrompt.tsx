import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { ratePromptStore } from '../lib/ratePrompt'
import { navigate } from '../lib/router'
import { Button, Sheet } from './Layout'
import { Poster } from './Poster'

/** "You finished X! Rate it?", shown when a tick finishes an unranked show. */
export function RatePrompt({ hidden }: { hidden: boolean }) {
  const id = ratePromptStore.use()
  const show = useLiveQuery(() => (id ? db.shows.get(id) : undefined), [id])
  if (!id || !show || hidden) return null

  const close = () => ratePromptStore.set(null)
  return (
    <Sheet open onClose={close}>
      <div className="flex flex-col items-center text-center">
        <Poster path={show.poster_path} name={show.name} size="md" />
        <h2 className="mt-4 text-lg font-semibold tracking-tight">You finished {show.name}!</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Rate it while it's fresh to add it to your rankings.</p>
        <div className="mt-5 flex w-full flex-col gap-3">
          <Button
            onClick={() => {
              close()
              navigate(`/rank/${id}`)
            }}
          >
            Rate it
          </Button>
          <Button variant="ghost" onClick={close}>
            Maybe later
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
