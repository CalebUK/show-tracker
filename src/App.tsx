import { useEffect, useState } from 'react'
import { isTab, useRoute, type Tab } from './lib/router'
import { refreshFollowed } from './lib/shows'
import { TabBar, Toast } from './components/Layout'
import { Upcoming } from './screens/Upcoming'
import { Rankings } from './screens/Rankings'
import { Search } from './screens/Search'
import { Settings } from './screens/Settings'
import { ShowDetail } from './screens/ShowDetail'
import { RankFlow } from './screens/RankFlow'

const SCREENS: Record<Tab, () => React.JSX.Element> = {
  upcoming: Upcoming,
  rankings: Rankings,
  search: Search,
  settings: Settings,
}

export function App() {
  const route = useRoute()
  // Detail and ranking screens open on top of whichever tab you came from.
  const [lastTab, setLastTab] = useState<Tab>(isTab(route) ? route.name : 'upcoming')
  const tab = isTab(route) ? route.name : lastTab
  useEffect(() => {
    setLastTab(tab)
    window.scrollTo(0, 0)
  }, [tab])

  // Refresh stale shows on open, when the app comes back to the foreground, and when back online.
  useEffect(() => {
    refreshFollowed()
    const onVisible = () => document.visibilityState === 'visible' && refreshFollowed()
    const onOnline = () => refreshFollowed()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  const Screen = SCREENS[tab]
  return (
    <>
      <main className="mx-auto max-w-xl pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        <Screen />
      </main>
      <TabBar active={tab} />
      {route.name === 'show' && <ShowDetail key={route.id} id={route.id} />}
      {route.name === 'rank' && <RankFlow key={route.id} id={route.id} />}
      <Toast />
    </>
  )
}
