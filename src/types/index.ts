export type Role = 'admin' | 'employee'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  avatarInitials: string
  joinDate: string
}

export interface Employee extends User {
  role: 'employee'
  jobTitle: string
  department: string
  managerId: string | null
}

export type FrequencyType = 'daily' | 'weekly' | 'monthly' | 'one-off'

export interface TaskFrequency {
  type: FrequencyType
  days?: number[] // 0=Sun,1=Mon,...6=Sat — for weekly
  weekOfMonth?: number // 1-4 — for monthly
  dayOfWeek?: number // 0-6 — for monthly
  date?: string // ISO date string — for one-off
}

export type Priority = 'low' | 'medium' | 'high'

export interface Category {
  id: string
  name: string
  color: string
}

export interface Task {
  id: string
  title: string
  description: string
  assignedTo: string[] // employee IDs
  frequency: TaskFrequency
  categoryId: string
  priority: Priority
  associatedTool?: string
  estimatedMinutes: number
  createdAt: string
  createdBy: string
  isActive: boolean
}

export interface CompletionLog {
  id: string
  taskId: string
  employeeId: string
  completedAt: string // full ISO timestamp
  dueDate: string // ISO date
  wasLate: boolean
  timeOfDay: 'early' | 'mid-morning' | 'afternoon' | 'end-of-day'
}

export interface Website {
  id: string
  name: string
  url: string
  description: string
  assignedTo: string[] // employee IDs
  faviconUrl?: string
}

export interface Document {
  id: string
  name: string
  type: string
  size: number
  uploadedAt: string
  uploadedBy: string
  storagePath: string // Supabase Storage object path
  folderId?: string
}

export interface Folder {
  id: string
  name: string
  ownerId: string
  createdAt: string
}

export interface Guidelines {
  employeeId: string
  content: string // HTML from rich text editor
  updatedAt: string
  updatedBy: string
}

export interface DailyStats {
  date: string
  employeeId: string
  assigned: number
  completed: number
  completionRate: number
}

export interface EmployeeStats {
  employeeId: string
  totalAssigned: number
  totalCompleted: number
  completionRate: number
  currentStreak: number
  longestStreak: number
  missedTasks: number
  averageCompletionHour: number
  dailyStats: DailyStats[]
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface TaskAttachment {
  id: string
  name: string
  type: string
  size: number
  storagePath: string // Supabase Storage object path
  uploadedAt: string
  uploadedBy: string
}

export interface TaskComment {
  id: string
  taskId: string
  authorId: string
  content: string
  createdAt: string
  attachments: TaskAttachment[]
}

export interface ActivityLog {
  id: string
  taskId: string
  actorId: string
  action: 'completed' | 'uncompleted' | 'in_progress' | 'commented' | 'file_uploaded'
  detail?: string
  timestamp: string
}

export interface AppNotification {
  id: string
  type: 'task_assigned' | 'task_due_today' | 'task_due_tomorrow' | 'task_overdue' | 'comment_added' | 'workload_alert' | 'inactivity_alert'
  title: string
  message: string
  taskId?: string
  isRead: boolean
  createdAt: string
  targetUserId: string | null // employee id, or null when targetRole is set
  targetRole: Role | null // 'admin' to notify all admins, else null
}
