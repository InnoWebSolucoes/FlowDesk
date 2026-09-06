import React from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { NotificationBell } from './NotificationBell'

const pageTitles: Record<string, string> = {
  // Pages inside a project render their own header, so only the top-level
  // routes need a title here.
  '/admin/projects': 'Projects',
  '/admin/employees': 'Employee profile',
  '/employee/tasks': 'My Tasks',
  '/employee/toolbox': 'Toolbox',
  '/employee/guidelines': 'Guidelines',
}

export function Layout() {
  const location = useLocation()

  // Inside a project the page renders its own header, so the top bar stays
  // generic rather than repeating "Projects" above it.
  const insideProject = /^\/admin\/projects\/[^/]+/.test(location.pathname)

  const title = insideProject
    ? 'Flowdesk'
    : Object.entries(pageTitles).find(([path]) => location.pathname.startsWith(path))?.[1] ?? 'Flowdesk'

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="bg-surface border-b border-border px-6 py-4 flex items-center justify-between md:pl-6 pl-16">
          <h1 className="text-text-main font-semibold text-lg">{title}</h1>
          <NotificationBell />
        </header>
        {/* Main content */}
        {/* h-full on the padding wrapper so a page that wants the whole frame
            — chat — can ask for it, instead of guessing the header height and
            leaving a strip of dead space when the guess is wrong. */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 h-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
