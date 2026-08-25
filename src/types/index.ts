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
  projectId: string | null
}

export interface Project {
  id: string
  name: string
  companyName: string
  description: string
  industry: string
  website?: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  address?: string
  color: string
  isArchived: boolean
  createdAt: string
}

/** A bubble on the resources canvas. Clusters nest arbitrarily deep. */
export interface ResourceCluster {
  id: string
  projectId: string
  parentClusterId: string | null
  title: string
  color: string
  x: number
  y: number
  radius: number
  createdAt: string
}

/** One archived iteration of a document's file. */
export interface ResourceItemVersion {
  id: string
  itemId: string
  storagePath: string
  fileName: string
  mimeType: string | null
  size: number | null
  label: string
  createdAt: string
}

export interface ResourceItemLink {
  id: string
  itemId: string
  label: string
  url: string
  sortOrder: number
}

/**
 * A node on the resources canvas: an uploaded file, a set of links, or both.
 * The file (storagePath/fileName/mimeType/size) is separable from the metadata
 * so it can be replaced without disturbing the title, description or links.
 */
export interface ResourceItem {
  id: string
  projectId: string
  clusterId: string | null
  title: string
  description: string
  storagePath: string | null
  fileName: string | null
  mimeType: string | null
  size: number | null
  x: number
  y: number
  createdAt: string
  updatedAt: string
  links: ResourceItemLink[]
  /** Past iterations of the file, newest first. The current file is separate. */
  versions: ResourceItemVersion[]
  /**
   * Every cluster this document appears in. `clusterId` is its home on the
   * canvas; these are the additional clusters it's tagged into. One document,
   * many places — never a copy.
   */
  clusterIds: string[]
  /** Whether the document also shows in the project's main space. */
  showAtTopLevel: boolean
  /** Who can see this document. Managers always can. */
  access: ResourceAccess
  /** User ids, when access is 'specific'. */
  accessUserIds: string[]
}

/**
 * everyone   — anyone on the project (the default)
 * managers   — admins only
 * employees  — admins and employees on the project
 * specific   — admins and the named people
 */
export type ResourceAccess = 'everyone' | 'managers' | 'employees' | 'specific'

export interface ProjectTodoLink {
  id: string
  todoId: string
  itemId: string | null
  clusterId: string | null
}

/** A named todo list within a project, e.g. "Onboarding". */
export interface ProjectTodoList {
  id: string
  projectId: string
  name: string
  color: string
  sortOrder: number
  createdAt: string
}

/** Manager-only todo. Never visible to employees. */
/** Who may see a calendar item, overriding the role default. */
export type Visibility = 'private' | 'team' | 'everyone'

export interface ProjectTodo {
  id: string
  projectId: string
  listId: string | null
  title: string
  notes: string
  priority: Priority
  isCompleted: boolean
  completedAt: string | null
  /** The hard deadline. */
  dueDate: string | null
  /** When you plan to actually do it — this is what the calendar shows. */
  doDate: string | null
  /** Optional time window on the do date; null start means all-day. */
  doStart: string | null
  doEnd: string | null
  assigneeId: string | null
  visibility: Visibility | null
  /** Individual people this todo is shared with, beyond the visibility rule. */
  sharedWith: string[]
  sortOrder: number
  createdAt: string
  links: ProjectTodoLink[]
}

export type CalendarEntryKind = 'busy' | 'working' | 'meeting' | 'timeoff'

/** Anything on the calendar that isn't a todo: busy blocks, hours, time off. */
export interface CalendarEntry {
  id: string
  projectId: string | null
  ownerId: string
  title: string
  notes: string
  kind: CalendarEntryKind
  startsAt: string
  endsAt: string
  allDay: boolean
  visibility: Visibility | null
  sharedWith: string[]
  /** Documents and clusters attached to this entry. */
  links: CalendarEntryLink[]
  createdAt: string
}

export interface CalendarEntryLink {
  id: string
  entryId: string
  itemId: string | null
  clusterId: string | null
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
  projectId: string
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
