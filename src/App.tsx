import { useEffect, useState } from 'react'
import { getRouteByPath } from './routes'

function getCurrentPath() {
  return window.location.pathname
}

export default function App() {
  const [pathname, setPathname] = useState(getCurrentPath)
  const currentRoute = getRouteByPath(pathname)
  const CurrentPage = currentRoute.component
  const isBatchRoute = currentRoute.path.startsWith('/batch')

  useEffect(() => {
    function handlePopState() {
      setPathname(getCurrentPath())
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function navigateTo(path: string) {
    window.history.pushState(null, '', path)
    setPathname(path)
  }

  return (
    <div className="demoPage">
      <header className="navBar">
        <div className="navBar__leading" aria-hidden />
        <h1 className="navBar__title">封面设计</h1>
        <button
          type="button"
          className="batchToggle"
          onClick={() => navigateTo(isBatchRoute ? '/' : '/batch/upload')}
        >
          {isBatchRoute ? '单张生成' : '批量生成'}
        </button>
      </header>

      <CurrentPage />
    </div>
  )
}
