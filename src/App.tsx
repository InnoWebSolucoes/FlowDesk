import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { useTaskStore } from './store/taskStore'
import { useEmployeeStore } from './store/employeeStore'
import { useToolStore } from './store/toolStore'
import { useNotificationStore } from './store/notificationStore'
import { useProjectStore } from './store/projectStore'
import { Layout } from './components/shared/Layout'

// Pages
import { Login } from './pages/Login'
import { ResetPassword } from './pages/ResetPassword'
import { Overview } from './pages/admin/Overview'
import { TaskManager } from './pages/admin/TaskManager'
import { AIOrganiser } from './pages/admin/AIOrganiser'
import { Employees } from './pages/admin/Employees'
import { EmployeeProfile } from './pages/admin/EmployeeProfile'
import { Analytics } from './pages/admin/Analytics'
import { Projects } from './pages/admin/Projects'
import { ProjectLayout } from './pages/admin/project/ProjectLayout'
import { ProjectAbout } from './pages/admin/project/ProjectAbout'
import { ProjectResources } from './pages/admin/project/ProjectResources'
import { ProjectEmployees } from './pages/admin/project/ProjectEmployees'
import { ProjectTodos } from './pages/admin/project/ProjectTodos'
import { MyTasks } from './pages/employee/MyTasks'
import { Toolbox } from './pages/employee/Toolbox'
import { Guidelines } from './pages/employee/Guidelines'

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

  useEffect(() => {
    initAuth()
  }, [])

  useEffect(() => {
    if (authStatus === 'authenticated') {
      initProjects()
      initEmployees()
      initTasks()
      initTools()
      initNotifications()
    }
  }, [authStatus])

  if (authStatus === 'loading') return <LoadingScreen />

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInitializer>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
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
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<Navigate to="about" replace />} />
              <Route path="about" element={<ProjectAbout />} />
              <Route path="resources" element={<ProjectResources />} />
              <Route path="employees" element={<ProjectEmployees />} />
              <Route path="todos" element={<ProjectTodos />} />
            </Route>
            <Route path="tasks" element={<TaskManager />} />
            <Route path="ai-organiser" element={<AIOrganiser />} />
            <Route path="employees" element={<Employees />} />
            <Route path="employees/:id" element={<EmployeeProfile />} />
            <Route path="analytics" element={<Analytics />} />
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
