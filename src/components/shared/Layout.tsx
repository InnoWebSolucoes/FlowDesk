import React from 'react'
import { Outlet, useLocation, useMatch } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ViewAsBanner } from './ViewAsBanner'
import { NotificationBell } from './NotificationBell'
import { useProjectStore } from '../../store/projectStore'

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

  const title = Object.entries(pageTitles).find(([path]) =>
    location.pathname.startsWith(path),
  )?.[1] ?? 'Flowdesk'

  // Which project, when inside one. Its name goes up here beside Flowdesk
  // rather than in a banner of its own on every page: the banner cost a
  // block of vertical space to say something the top bar can say in a word.
  const projectMatch = useMatch('/admin/projects/:projectId/*')
  const activeProject = useProjectStore((s) =>
    projectMatch?.params.projectId
      ? s.projects.find((p) => p.id === projectMatch.params.projectId)
      : undefined,
  )

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Above everything, including the sidebar's own chrome: forgetting
            you are inside somebody else's account is the one failure mode
            this feature has. */}
        <ViewAsBanner />
        {/* Top bar */}
        <header className="h-16 bg-surface border-b border-border px-6 flex items-center justify-between flex-shrink-0 md:pl-6 pl-16">
          <h1 className="text-text-main font-semibold text-lg flex items-center gap-2 min-w-0">
            <span className="flex-shrink-0">{insideProject ? 'Flowdesk' : title}</span>
            {activeProject && (
              <>
                <span className="text-text-subtle font-normal flex-shrink-0">/</span>
                <span
                  className="truncate px-2 py-0.5 rounded-md text-base"
                  style={{
                    backgroundColor: `${activeProject.color}1f`,
                    color: activeProject.color,
                  }}
                >
                  {activeProject.name}
                </span>
              </>
            )}
          </h1>
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
              content up and left the padding showing as a strip underneath.

              min-h-full, not h-full, for everything else. h-full pins the box
              to the window's height, and content taller than that overflows
              the padding edge rather than pushing it down — so the bottom
              padding sat where the fold was and the last card in a long list
              ran off the bottom of the window with nothing under it. Growing
              with the content puts the padding after it, where it reads as a
              margin. pb-16 rather than the p-6 all round: the end of a long
              scroll wants more room under it than the sides need beside it,
              and on the desktop app the taskbar eats the last few pixels. */}
          <div className={`w-full ${isChat ? 'h-full' : 'min-h-full p-6 pb-16 max-w-[1600px] mx-auto'}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
