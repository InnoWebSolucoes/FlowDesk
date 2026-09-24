import React, { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useT } from '../../i18n/useT'

/** The script a built index.html starts the app with: /assets/index-<hash>.js. */
const BUNDLE = /\/assets\/index-[\w-]+\.js/

/** The bundle this window is running, from the index.html it was opened with. */
function runningBundle() {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
  return script?.getAttribute('src')?.match(BUNDLE)?.[0] ?? null
}

/** The bundle the site hands out now. Null when that cannot be told. */
async function servedBundle() {
  try {
    const res = await fetch(`/index.html?check=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    // The script tag's own src, not the first mention of a bundle name: a
    // preload link for another file could come before it.
    const tag = (await res.text()).match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)?.find((s) => BUNDLE.test(s))
    return tag?.match(BUNDLE)?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * Says so when a newer FlowDesk has been published than the one this window
 * is running.
 *
 * A window stays on the version it was opened with until it is reloaded, and
 * the desktop app's window is rarely closed — so a change could be live for a
 * day while someone kept working on, and asking about, the version before it.
 * Checked when the window comes back into use and every few minutes, against
 * the name of the script the site now serves, which changes with every build.
 * It offers the reload rather than doing it: a reload in the middle of typing
 * would lose what was being typed.
 */
export function UpdateBanner() {
  const { t } = useT()
  const [outdated, setOutdated] = useState(false)

  useEffect(() => {
    const running = runningBundle()
    // The dev server has no built bundle to compare against.
    if (!running) return

    let stopped = false
    const check = async () => {
      if (stopped || document.hidden) return
      const served = await servedBundle()
      if (!stopped && served && served !== running) setOutdated(true)
    }

    const timer = window.setInterval(check, 5 * 60 * 1000)
    const onVisible = () => {
      if (!document.hidden) check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    check()

    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
    }
  }, [])

  if (!outdated) return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary text-white text-sm px-4 py-2 flex-shrink-0">
      <span>{t('update_available')}</span>
      <button
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 font-semibold bg-white/15 hover:bg-white/25 rounded-md px-2.5 py-1 transition-colors"
      >
        <RefreshCw size={14} /> {t('update_reload')}
      </button>
    </div>
  )
}
