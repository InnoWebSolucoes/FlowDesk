import React from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'

const pageTitles: Record<string, string> = {
  '/admin/overview': 'Overview',
  '/admin/tasks': 'Task Manager',
  '/admin/ai-organiser': 'AI Organiser',
  '/admin/employees': 'Employees',
  '/admin/analytics': 'Analytics',
  '/admin/gantt': 'Gantt Chart',
  '/employee/tasks': 'My Tasks',
  '/employee/gantt': 'My Schedule',
  '/employee/toolbox': 'Toolbox',
  '/employee/guidelines': 'Guidelines',
}

export function Layout() {
  const location = useLocation()

  const title = Object.entries(pageTitles).find(([path]) =>
    location.pathname.startsWith(path)
  )?.[1] ?? 'Flowdesk'

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="bg-surface border-b border-border px-6 py-4 flex items-center md:pl-6 pl-16">
          <h1 className="text-text-main font-semibold text-lg">{title}</h1>
        </header>
        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
