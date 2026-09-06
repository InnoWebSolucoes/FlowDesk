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
  // Chat is full-bleed: capping it would leave gutters either side of a page
  // that is meant to fill the frame.
  const isChat = location.pathname.endsWith('/chat')

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
        <header className="h-16 bg-surface border-b border-border px-6 flex items-center justify-between flex-shrink-0 md:pl-6 pl-16">
          <h1 className="text-text-main font-semibold text-lg">{title}</h1>
          <NotificationBell />
        </header>
        {/* Main content.
            min-h-0 lets this flex child actually shrink, which is what gives
            the wrapper below a real height to fill: without it h-full inside
            resolves against nothing and the page collapses to its content.
            Chat scrolls its own panes, so scrolling here is for everything
            else. */}
        <main className={`flex-1 min-h-0 ${isChat ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {/* Capped and centred: with the sidebar collapsed the window is
              wide enough that a full-bleed row leaves its title at one edge
              and its dates at the other, with nothing in between. */}
          {/* No padding for chat rather than padding it cancels with -m-6:
              h-full measures the padded box, so the negative margin pulled the
              content up and left the padding showing as a strip underneath. */}
          <div className={`h-full w-full ${isChat ? '' : 'p-6 max-w-[1600px] mx-auto'}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
