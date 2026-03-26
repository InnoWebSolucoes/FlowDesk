import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ListTodo, Sparkles, Users, BarChart3,
  GanttChartSquare, CheckSquare, Calendar, Wrench, BookOpen,
  LogOut, Menu, X
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useLanguageStore } from '../../store/languageStore'
import { useT } from '../../i18n/useT'

export function Sidebar() {
  const { currentUser, logout } = useAuthStore()
  const { toggle, lang } = useLanguageStore()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { t } = useT()

  const adminNav = [
    { to: '/admin/overview', label: t('nav_overview'), icon: <LayoutDashboard size={18} /> },
    { to: '/admin/tasks', label: t('nav_taskManager'), icon: <ListTodo size={18} /> },
    { to: '/admin/ai-organiser', label: t('nav_aiOrganiser'), icon: <Sparkles size={18} /> },
    { to: '/admin/employees', label: t('nav_employees'), icon: <Users size={18} /> },
    { to: '/admin/analytics', label: t('nav_analytics'), icon: <BarChart3 size={18} /> },
    { to: '/admin/gantt', label: t('nav_ganttChart'), icon: <GanttChartSquare size={18} /> },
  ]

  const employeeNav = [
    { to: '/employee/tasks', label: t('nav_myTasks'), icon: <CheckSquare size={18} /> },
    { to: '/employee/gantt', label: t('nav_mySchedule'), icon: <Calendar size={18} /> },
    { to: '/employee/toolbox', label: t('nav_toolbox'), icon: <Wrench size={18} /> },
    { to: '/employee/guidelines', label: t('nav_guidelines'), icon: <BookOpen size={18} /> },
  ]

  const navItems = currentUser?.role === 'admin' ? adminNav : employeeNav

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">F</span>
        </div>
        <span className="font-semibold text-text-main text-base">Flow Desk</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text-main'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Language toggle + User section */}
      <div className="border-t border-border px-3 py-3 space-y-2">
        {/* Language toggle */}
        <button
          onClick={toggle}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors"
          title={lang === 'en' ? 'Mudar para Português' : 'Switch to English'}
        >
          <span className="text-text-muted text-xs font-medium">{lang === 'en' ? '🇧🇷 Português' : '🇬🇧 English'}</span>
          <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">
            {t('lang_switchLabel')}
          </span>
        </button>

        {/* User */}
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">{currentUser?.avatarInitials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-text-main text-sm font-medium truncate">{currentUser?.name}</p>
            <p className="text-text-subtle text-xs capitalize">{currentUser?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-text-subtle hover:text-danger transition-colors p-1 rounded"
            title="Logout"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile toggle button */}
      <button
        className="md:hidden fixed top-4 left-4 z-50 w-9 h-9 bg-surface border border-border rounded-lg flex items-center justify-center shadow-sm"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 bg-surface border-r border-border flex-shrink-0 h-screen sticky top-0">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      <aside
        className={`md:hidden fixed top-0 left-0 h-full w-60 bg-surface border-r border-border z-50 flex flex-col transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent />
      </aside>
    </>
  )
}
