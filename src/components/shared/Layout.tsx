import React from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ViewAsBanner } from './ViewAsBanner'

export function Layout() {
  const location = useLocation()
  // Chat is full-bleed: capping it would leave gutters either side of a page
  // that is meant to fill the frame.
  const isChat = location.pathname.endsWith('/chat')

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Above everything, including the sidebar's own chrome: forgetting
            you are inside somebody else's account is the one failure mode
            this feature has. */}
        <ViewAsBanner />
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
          {/* pt-20 on a phone, where the floating menu button now has no top
              bar to sit in and would otherwise land on the first line of the
              page. */}
          <div className={`w-full ${isChat ? 'h-full' : 'min-h-full p-6 pt-20 md:pt-6 pb-16 max-w-[1600px] mx-auto'}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
