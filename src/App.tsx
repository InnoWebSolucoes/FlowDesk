import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { useTaskStore } from './store/taskStore'
import { useEmployeeStore } from './store/employeeStore'
import { useToolStore } from './store/toolStore'
import { useNotificationStore } from './store/notificationStore'
import { useProjectStore } from './store/projectStore'
import { useChatStore } from './store/chatStore'
import { Layout } from './components/shared/Layout'

// Pages
import { Login } from './pages/Login'
import { ResetPassword } from './pages/ResetPassword'
import { Overview } from './pages/admin/Overview'
import { TaskManager } from './pages/admin/TaskManager'
import { AIOrganiser } from './pages/admin/AIOrganiser'
import { EmployeeProfile } from './pages/admin/EmployeeProfile'
import { Analytics } from './pages/admin/Analytics'
import { Projects } from './pages/admin/Projects'
import { ProjectLayout } from './pages/admin/project/ProjectLayout'
import { ProjectAbout } from './pages/admin/project/ProjectAbout'
import { ProjectResources } from './pages/admin/project/ProjectResources'
import { ProjectEmployees } from './pages/admin/project/ProjectEmployees'
import { ProjectAdmins } from './pages/admin/project/ProjectAdmins'
import { ProjectTodos } from './pages/admin/project/ProjectTodos'
import { ProjectCalendar } from './pages/admin/project/ProjectCalendar'
import { ProjectNotes } from './pages/admin/project/ProjectNotes'
import { ProjectTeamLayout } from './pages/admin/project/ProjectTeamLayout'
import { MyTasks } from './pages/employee/MyTasks'
import { Toolbox } from './pages/employee/Toolbox'
import { Guidelines } from './pages/employee/Guidelines'
import { EmployeeWorkspace } from './pages/employee/EmployeeWorkspace'
import { MyTodos } from './pages/employee/MyTodos'
import { MyNotes } from './pages/employee/MyNotes'
import { MyResources } from './pages/employee/MyResources'
import { MyCalendar } from './pages/employee/MyCalendar'
import { Chat } from './pages/Chat'

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <svg className="animate-spin w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}

/**
 * Where "/" should land. Sending it straight to /login would sign out anyone
 * who opens the app at its root with a valid stored session — which is what
 * the desktop app does on every launch.
 */
function RootRedirect() {
  const { status, currentUser } = useAuthStore()

  if (status === 'loading') return <LoadingScreen />
  if (status === 'unauthenticated') return <Navigate to="/login" replace />
  if (currentUser?.role === 'admin') return <Navigate to="/admin/projects" replace />
  return <Navigate to="/employee/tasks" replace />
}

/**
 * The login page, but skipped for anyone already signed in — otherwise a
 * restored session still shows a login form until the user reloads.
 */
function LoginRoute() {
  const { status, currentUser } = useAuthStore()

  if (status === 'loading') return <LoadingScreen />
  if (status === 'authenticated') {
    if (currentUser?.role === 'admin') return <Navigate to="/admin/projects" replace />
    return <Navigate to="/employee/tasks" replace />
  }
  return <Login />
}

function ProtectedRoute({
  children,
  requiredRole,
}: {
  children: React.ReactNode
  requiredRole?: 'admin' | 'employee'
}) {
  const { status, currentUser } = useAuthStore()

  if (status === 'loading') return <LoadingScreen />
  if (status === 'unauthenticated') return <Navigate to="/login" replace />

  if (requiredRole && currentUser?.role !== requiredRole) {
    if (currentUser?.role === 'admin') return <Navigate to="/admin/projects" replace />
    return <Navigate to="/employee/tasks" replace />
  }

  return <>{children}</>
}

function AppInitializer({ children }: { children: React.ReactNode }) {
  const authStatus = useAuthStore(s => s.status)
  const initAuth = useAuthStore(s => s.initialize)
  const initTasks = useTaskStore(s => s.initialize)
  const initEmployees = useEmployeeStore(s => s.initialize)
  const initTools = useToolStore(s => s.initialize)
  const initNotifications = useNotificationStore(s => s.initialize)
  const initProjects = useProjectStore(s => s.initialize)
  const initChat = useChatStore(s => s.initialize)
  const currentUserId = useAuthStore(s => s.currentUser?.id)

  useEffect(() => {
    initAuth()
  }, [])

  const tearDownTasks = useTaskStore(s => s.teardown)
  const tearDownNotifications = useNotificationStore(s => s.teardown)
  const tearDownProjects = useProjectStore(s => s.teardown)
  const tearDownChat = useChatStore(s => s.teardown)

  useEffect(() => {
    if (authStatus === 'authenticated') {
      initProjects()
      initEmployees()
      initTasks()
      initTools()
      initNotifications()
      // Chat is per-person — whose rooms these are decides what comes back —
      // so it needs the id, not just the fact that someone is signed in.
      if (currentUserId) initChat(currentUserId)
      return
    }

    // Only a real sign-out tears down. 'loading' is the phase before the stored
    // session has been read back, and treating it as signed-out wiped chat's
    // state on every single load — including the id its writes guard on, which
    // is why sending a message silently did nothing.
    if (authStatus !== 'unauthenticated') return

    // Signing out has to close the live channels too. They are subscribed with
    // the old session's credentials, so leaving them open means the next user
    // inherits someone else's subscriptions.
    tearDownTasks()
    tearDownNotifications()
    tearDownProjects()
    tearDownChat()
  }, [authStatus, currentUserId])

  if (authStatus === 'loading') return <LoadingScreen />

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInitializer>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Admin routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute requiredRole="admin">
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="projects" replace />} />
            <Route path="overview" element={<Overview />} />
            <Route path="chat" element={<Chat />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<Navigate to="about" replace />} />
              <Route path="about" element={<ProjectAbout />} />
              <Route path="resources" element={<ProjectResources />} />
              <Route path="todos" element={<ProjectTodos />} />
              <Route path="calendar" element={<ProjectCalendar />} />
              <Route path="notes" element={<ProjectNotes />} />
              {/* Chat inside the project, so opening it does not drop you out
                  of the one you are working in. Same component: it works out
                  which project a conversation belongs to on its own. */}
              <Route path="chat" element={<Chat />} />

              {/* Employees: the team plus everything that used to be global,
                  scoped to this project by ProjectLayout. */}
              <Route path="employees" element={<ProjectTeamLayout />}>
                <Route index element={<Navigate to="team" replace />} />
                <Route path="team" element={<ProjectEmployees />} />
                <Route path="overview" element={<Overview />} />
                <Route path="tasks" element={<TaskManager />} />
                <Route path="ai-organiser" element={<AIOrganiser />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="admins" element={<ProjectAdmins />} />

                {/* A profile is opened from the team tab and stays inside it,
                    so the project and team tabs do not vanish underneath. */}
                <Route path="team/:id" element={<EmployeeProfile />} />
              </Route>
            </Route>
          </Route>

          {/* Employee routes */}
          <Route
            path="/employee"
            element={
              <ProtectedRoute requiredRole="employee">
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="tasks" replace />} />
            <Route path="tasks" element={<MyTasks />} />

            {/* The employee's side of their project: the same todos, notes and
                files the managers have, scoped to them. EmployeeWorkspace
                resolves the project from their profile, the way ProjectLayout
                resolves it from the URL on the admin side. */}
            <Route element={<EmployeeWorkspace />}>
              <Route path="todos" element={<MyTodos />} />
              <Route path="calendar" element={<MyCalendar />} />
              <Route path="notes" element={<MyNotes />} />
              <Route path="resources" element={<MyResources />} />
            </Route>

            <Route path="chat" element={<Chat />} />
            <Route path="toolbox" element={<Toolbox />} />
            <Route path="guidelines" element={<Guidelines />} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AppInitializer>
    </BrowserRouter>
  )
}
