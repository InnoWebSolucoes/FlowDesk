import React from 'react'
import { Eye, X } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useT } from '../../i18n/useT'

/**
 * The strip that says you are looking at somebody else's FlowDesk.
 *
 * Loud on purpose, and across the top of every page rather than tucked into a
 * corner. The whole point of the preview is that it is indistinguishable from
 * the real thing, which is exactly what makes it dangerous to forget you are
 * in it — an owner who thinks they are on their own side and starts editing
 * is editing an employee's work.
 */
export function ViewAsBanner() {
  const viewAs = useAuthStore((s) => s.viewAs)
  const setViewAs = useAuthStore((s) => s.setViewAs)
  const { t } = useT()

  if (!viewAs) return null

  /**
   * Leaving is one thing: stop being them. Where that lands is not decided
   * here at all.
   *
   * It used to navigate as well, which was the bug. Dropping the preview
   * makes the owner an admin standing on an /employee route, and
   * ProtectedRoute exists to move them off it — so two navigations raced and
   * the guard's won, dumping you outside the project. Now only the guard
   * navigates, and it sends you to the page the preview was entered from.
   */
  const leave = () => setViewAs(null)

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-amber text-white flex-shrink-0">
      <Eye size={15} className="flex-shrink-0" />
      <p className="text-sm font-medium min-w-0 flex-1 truncate">
        {t('viewas_banner').replace('{name}', viewAs.name)}
      </p>
      {/* Says what is not being recorded, because the obvious worry about a
          feature like this is that looking at somebody's day quietly counts
          as them having worked it. */}
      <span className="hidden md:inline text-xs opacity-80 flex-shrink-0">
        {t('viewas_notCounted')}
      </span>
      <button
        onClick={leave}
        className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-white/20 hover:bg-white/30 text-sm font-medium transition-colors flex-shrink-0"
      >
        <X size={14} />
        {t('viewas_leave')}
      </button>
    </div>
  )
}
