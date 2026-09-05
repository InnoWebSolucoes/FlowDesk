import React, { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate, useMatch, Link, useLocation } from 'react-router-dom'
import {
  ListTodo, Users, Info, FolderOpen, CalendarDays,
  CheckSquare, Wrench, BookOpen, Building2, MessageCircle, MessageSquare, StickyNote, Sparkles,
  LogOut, Menu, X, ChevronLeft, PanelLeftClose, PanelLeftOpen
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useProjectStore } from '../../store/projectStore'
import { useLanguageStore } from '../../store/languageStore'
import { useChatStore } from '../../store/chatStore'
import { useT } from '../../i18n/useT'
import {
  canDockWhatsapp, setWhatsappTab, onWhatsappState,
  canDockClaude, setClaudeTab, onClaudeState, setSidebarWidth,
} from '../../lib/nativeShare'

export function Sidebar() {
  const { currentUser, logout } = useAuthStore()
  const { toggle, lang } = useLanguageStore()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { t } = useT()

  // Inside a project the sidebar mirrors its tabs; outside it just offers the
  // way back to the picker, since everything else now lives within a project.
  const projectMatch = useMatch('/admin/projects/:projectId/*')
  const activeProjectId = projectMatch?.params.projectId
  const activeProject = useProjectStore((s) =>
    activeProjectId ? s.projects.find((p) => p.id === activeProjectId) : undefined
  )

  // The project's own tabs live in its header; the sidebar carries the tabs
  // themselves so they're reachable from anywhere inside the project.
  const adminNav = activeProjectId
    ? [
        { to: `/admin/projects/${activeProjectId}/todos`, label: t('nav_todos'), icon: <ListTodo size={18} /> },
        { to: `/admin/projects/${activeProjectId}/resources`, label: t('nav_resources'), icon: <FolderOpen size={18} /> },
        { to: `/admin/projects/${activeProjectId}/calendar`, label: t('nav_calendar'), icon: <CalendarDays size={18} /> },
        { to: `/admin/projects/${activeProjectId}/employees`, label: t('nav_employees'), icon: <Users size={18} /> },
        { to: `/admin/projects/${activeProjectId}/notes`, label: t('nav_notes'), icon: <StickyNote size={18} /> },
        { to: '/admin/chat', label: t('nav_chat'), icon: <MessageSquare size={18} /> },
      ]
    : [
        { to: '/admin/projects', label: t('nav_projects'), icon: <Building2 size={18} /> },
        { to: '/admin/chat', label: t('nav_chat'), icon: <MessageSquare size={18} /> },
      ]

  // The same tabs the managers get inside a project, plus the employee's own
  // assigned work. Todos, resources and notes are their side of the project:
  // their own lists and board, and the project's files.
  const employeeNav = [
    { to: '/employee/tasks', label: t('nav_myTasks'), icon: <CheckSquare size={18} /> },
    { to: '/employee/todos', label: t('nav_todos'), icon: <ListTodo size={18} /> },
    { to: '/employee/resources', label: t('nav_resources'), icon: <FolderOpen size={18} /> },
    { to: '/employee/calendar', label: t('nav_calendar'), icon: <CalendarDays size={18} /> },
    { to: '/employee/notes', label: t('nav_notes'), icon: <StickyNote size={18} /> },
    { to: '/employee/chat', label: t('nav_chat'), icon: <MessageSquare size={18} /> },
    { to: '/employee/toolbox', label: t('nav_toolbox'), icon: <Wrench size={18} /> },
    { to: '/employee/guidelines', label: t('nav_guidelines'), icon: <BookOpen size={18} /> },
  ]

  // Live, so a message arriving while you are on another tab shows up on the
  // Chat tab without a reload.
  const unreadChats = useChatStore((s) => s.totalUnread())

  const navItems = (currentUser?.role === 'admin' ? adminNav : employeeNav).map((item) =>
    item.to.endsWith('/chat') ? { ...item, badge: unreadChats } : item
  )

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // ─── WhatsApp tab ─────────────────────────────────────────────────────────
  // WhatsApp is a native view the desktop shell lays over this page, not a
  // route: a web page cannot embed web.whatsapp.com. So the tab asks the shell
  // to show it, and follows the shell's state rather than owning it.
  const whatsappAvailable = canDockWhatsapp()
  const claudeAvailable = canDockClaude()
  const [whatsappDocked, setWhatsappDocked] = useState(false)
  const [claudeDocked, setClaudeDocked] = useState(false)
  const location = useLocation()

  // Either docked view covers the page, so both suppress the route's highlight.
  const nativeTabOpen = whatsappDocked || claudeDocked

  useEffect(
    () => onWhatsappState(({ open, mode }) => setWhatsappDocked(open && mode === 'dock')),
    []
  )

  useEffect(() => onClaudeState(({ docked }) => setClaudeDocked(docked)), [])

  // Opening WhatsApp does not change the route, so picking the tab you were
  // already on — the common case, since WhatsApp covered it — would leave the
  // route identical and close nothing. Every nav link closes it on click
  // instead, which makes the tabs behave as one selection rather than a toggle
  // layered over the page.
  // Read through a ref, not the state values directly. The route-change effect
  // below runs with the deps it declares, so closing over the flags would use
  // whatever they were on the last route change — stale by the time a tab is
  // clicked, which left the Claude tab open when switching tabs.
  const dockedRef = useRef({ whatsapp: false, claude: false })
  dockedRef.current = { whatsapp: whatsappDocked, claude: claudeDocked }

  // Collapsed to icons only, to give the main area more room. Remembered, so
  // the choice survives a reload.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('flowdesk.sidebarCollapsed') === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('flowdesk.sidebarCollapsed', collapsed ? '1' : '0')
    } catch {}
    // The docked native views start where the sidebar ends, so the shell has
    // to be told when that width changes or they would overlap or leave a gap.
    setSidebarWidth(collapsed ? 64 : 240)
  }, [collapsed])

  const leaveNativeTabs = () => {
    if (dockedRef.current.whatsapp) setWhatsappTab(false)
    if (dockedRef.current.claude) setClaudeTab(false)
  }

  // Still needed for the ways out that are not a sidebar click: the project
  // name, "All projects", or anything else that navigates.
  useEffect(() => {
    leaveNativeTabs()
    // Only on a route change — depending on the docked flags would close them
    // immediately after they opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // A plain function, not a component: it closes over local state, and
  // remounting it on every render would drop focus and animation state.
  // `mini` is the desktop collapsed rail; the mobile drawer always shows text,
  // since it slides over the page and is not competing for room.
  const sidebarContent = (mini = false) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div
        className={`flex items-center border-b border-border ${
          mini ? 'justify-center px-2 py-5' : 'gap-2.5 px-5 py-5'
        }`}
      >
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">F</span>
        </div>
        {!mini && <span className="font-semibold text-text-main text-base">Flow Desk</span>}
      </div>

      {/* Which project you're inside, with the way back out. Collapsed, the
          project is just its colour dot, the name has nowhere to go. */}
      {activeProject && mini && (
        <div className="px-2 pt-3 pb-1 flex justify-center">
          <NavLink
            to={`/admin/projects/${activeProjectId}/about`}
            onClick={() => {
              setMobileOpen(false)
              leaveNativeTabs()
            }}
            title={`${activeProject.name}, project details`}
            className={({ isActive }) =>
              `w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                isActive && !nativeTabOpen ? 'bg-primary-light ring-1 ring-primary/30' : 'hover:bg-surface-2'
              }`
            }
          >
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: activeProject.color }}
            />
          </NavLink>
        </div>
      )}
      {activeProject && !mini && (
        <div className="px-3 pt-3 pb-1">
          <Link
            to="/admin/projects"
            onClick={() => {
              setMobileOpen(false)
              leaveNativeTabs()
            }}
            className="flex items-center gap-1 text-[11px] text-text-subtle hover:text-text-main mb-2 px-2 transition-colors"
          >
            <ChevronLeft size={12} /> All projects
          </Link>
          {/* The project name is the way into its details, so About needs no
              tab of its own. */}
          <NavLink
            to={`/admin/projects/${activeProjectId}/about`}
            onClick={() => {
              setMobileOpen(false)
              leaveNativeTabs()
            }}
            title={`${activeProject.name}, project details`}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                isActive && !nativeTabOpen
                  ? 'bg-primary-light ring-1 ring-primary/30'
                  : 'bg-surface-2 hover:bg-border'
              }`
            }
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: activeProject.color }}
            />
            <span className="text-sm font-medium text-text-main truncate flex-1">{activeProject.name}</span>
            <Info size={13} className="text-text-subtle flex-shrink-0" />
          </NavLink>
        </div>
      )}

      {/* Nav */}
      <nav className={`flex-1 py-4 space-y-0.5 overflow-y-auto ${mini ? 'px-2' : 'px-3'}`}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => {
              setMobileOpen(false)
              leaveNativeTabs()
            }}
            // Collapsed, the label only exists as a tooltip.
            title={mini ? item.label : undefined}
            className={({ isActive }) =>
              // While a docked view is covering the page it is the selected
              // tab, so the route's own tab must not stay lit as well —
              // otherwise two tabs look active at once.
              `flex items-center rounded-lg text-sm font-medium transition-all duration-150 ${
                mini ? 'justify-center h-10' : 'gap-3 px-3 py-2.5'
              } ${
                isActive && !nativeTabOpen
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text-main'
              }`
            }
          >
            {/* Collapsed, the badge rides the icon; expanded, it sits at the
                end of the row where a count belongs. */}
            {mini && 'badge' in item && (item.badge ?? 0) > 0 ? (
              <span className="relative">
                {item.icon}
                <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                  {(item.badge ?? 0) > 9 ? '9+' : item.badge}
                </span>
              </span>
            ) : (
              item.icon
            )}
            {!mini && item.label}
            {!mini && 'badge' in item && (item.badge ?? 0) > 0 && (
              <span className="ml-auto min-w-[18px] h-[18px] bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                {(item.badge ?? 0) > 99 ? '99+' : item.badge}
              </span>
            )}
          </NavLink>
        ))}

        {/* Below the other tabs, since it is a tool rather than part of the
            project's data. Desktop app only, a browser cannot embed it. */}
        {whatsappAvailable && (
          <button
            onClick={() => {
              setMobileOpen(false)
              // Always open, never toggle: a tab does not deselect itself when
              // you click it again. You leave by picking another tab.
              setWhatsappTab(true)
            }}
            title={mini ? 'WhatsApp' : undefined}
            className={`w-full flex items-center rounded-lg text-sm font-medium transition-all duration-150 ${
              mini ? 'justify-center h-10' : 'gap-3 px-3 py-2.5'
            } ${
              whatsappDocked
                ? 'bg-[#25d366] text-white'
                : 'text-text-muted hover:bg-surface-2 hover:text-text-main'
            }`}
          >
            <MessageCircle size={18} />
            {!mini && 'WhatsApp'}
          </button>
        )}

        {claudeAvailable && (
          <button
            onClick={() => {
              setMobileOpen(false)
              setClaudeTab(true)
            }}
            title={mini ? 'Claude' : undefined}
            className={`w-full flex items-center rounded-lg text-sm font-medium transition-all duration-150 ${
              mini ? 'justify-center h-10' : 'gap-3 px-3 py-2.5'
            } ${
              claudeDocked
                ? 'bg-[#d97757] text-white'
                : 'text-text-muted hover:bg-surface-2 hover:text-text-main'
            }`}
          >
            <Sparkles size={18} />
            {!mini && 'Claude'}
          </button>
        )}
      </nav>

      {/* Language toggle + User section */}
      <div className={`border-t border-border py-3 space-y-2 ${mini ? 'px-2' : 'px-3'}`}>
        {/* Language toggle: collapsed, the flag alone carries it. */}
        <button
          onClick={toggle}
          className={`w-full flex items-center rounded-lg hover:bg-surface-2 transition-colors ${
            mini ? 'justify-center h-9' : 'justify-between px-3 py-2'
          }`}
          title={lang === 'en' ? 'Mudar para Português' : 'Switch to English'}
        >
          {mini ? (
            <span className="text-base leading-none">{lang === 'en' ? '🇧🇷' : '🇬🇧'}</span>
          ) : (
            <>
              <span className="text-text-muted text-xs font-medium">{lang === 'en' ? '🇧🇷 Português' : '🇬🇧 English'}</span>
              <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">
                {t('lang_switchLabel')}
              </span>
            </>
          )}
        </button>

        {/* User: collapsed, the avatar is the logout button's own tooltip. */}
        {mini ? (
          <button
            onClick={handleLogout}
            title={`${currentUser?.name}, log out`}
            className="w-full flex justify-center py-1 rounded-lg hover:bg-surface-2 transition-colors group"
          >
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center group-hover:bg-danger transition-colors">
              <span className="text-white text-xs font-bold">{currentUser?.avatarInitials}</span>
            </div>
          </button>
        ) : (
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
        )}

        {/* Collapse to icons, for more room in the main area. Desktop only -
            the mobile drawer slides away entirely and needs no rail. */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`hidden md:flex w-full items-center rounded-lg text-text-subtle hover:bg-surface-2 hover:text-text-main transition-colors ${
            mini ? 'justify-center h-9' : 'gap-2 px-3 py-2'
          }`}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!mini && <span className="text-xs font-medium">Collapse</span>}
        </button>
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
      <aside
        className={`hidden md:flex flex-col bg-surface border-r border-border flex-shrink-0 h-screen sticky top-0 transition-[width] duration-200 ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        {sidebarContent(collapsed)}
      </aside>

      {/* Mobile sidebar */}
      <aside
        className={`md:hidden fixed top-0 left-0 h-full w-60 bg-surface border-r border-border z-50 flex flex-col transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent()}
      </aside>
    </>
  )
}
