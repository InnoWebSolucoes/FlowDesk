import React, { useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Globe, Eye } from 'lucide-react'
import { useEmployeeStore } from '../../store/employeeStore'
import { useToolStore } from '../../store/toolStore'
import { useAuthStore } from '../../store/authStore'
import { TaskManager } from './TaskManager'
import { MyTasks } from '../employee/MyTasks'
import { Analytics } from './Analytics'
import { AppUsagePanel } from '../../components/charts/AppUsagePanel'
import { EmptyState } from '../../components/shared/EmptyState'
import { WebsiteGrid } from '../../components/shared/WebsiteGrid'
import { TodoBoard } from '../../components/todos/TodoBoard'
import { NoteBoard } from '../../components/notes/NoteBoard'
import { CalendarBoard } from '../../components/calendar/CalendarBoard'
import { useProjectStore } from '../../store/projectStore'
import { format, parseISO } from 'date-fns'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Italic, List, ListOrdered, Heading2 } from 'lucide-react'
import { useT } from '../../i18n/useT'
import { Avatar } from '../../components/shared/Avatar'
import { WorkLog } from '../../components/worklog/WorkLog'

const TABS = ['tasks', 'analytics', 'worklog', 'todos', 'calendar', 'notes', 'toolbox', 'guidelines'] as const
type Tab = typeof TABS[number]

/** The four cuts of somebody's work, in the order they read in. */
const TASK_SECTIONS = ['today', 'week', 'month', 'all'] as const
type TaskSection = typeof TASK_SECTIONS[number]

export function EmployeeProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // Unscoped: the profile renders outside the project shell, where the scoped
  // list has been cleared.
  const { allEmployees } = useEmployeeStore()
  const { websites, getGuidelines, saveGuidelines } = useToolStore()
  const { currentUser } = useAuthStore()
  const setViewAs = useAuthStore((s) => s.setViewAs)
  const isOwner = !!useAuthStore((s) => s.realUser?.isOwner)
  const getProject = useProjectStore((s) => s.getProject)
  const { t, dateLocale } = useT()

  const [tab, setTab] = useState<Tab>('tasks')
  const [taskSection, setTaskSection] = useState<TaskSection>('today')
  const [guideSaved, setGuideSaved] = useState(false)

  const emp = allEmployees.find(e => e.id === id)
  // Back goes to the team list of whichever project they belong to.
  const backTo = emp?.projectId
    ? `/admin/projects/${emp.projectId}/employees/team`
    : '/admin/projects'
  const guidelines = id ? getGuidelines(id) : undefined

  const editor = useEditor({
    extensions: [StarterKit],
    content: guidelines?.content ?? `<p>${t('profile_guidelinesPlaceholder')}</p>`,
  })

  if (!emp) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-text-muted mb-4">{t('profile_notFound')}</p>
        <button onClick={() => navigate(backTo)} className="text-primary text-sm">{t('profile_back')}</button>
      </div>
    )
  }

  const empWebsites = websites.filter(w => w.assignedTo.includes(emp.id))

  const handleSaveGuide = async () => {
    if (!editor || !id || !currentUser) return
    await saveGuidelines(id, editor.getHTML(), currentUser.id)
    setGuideSaved(true)
    setTimeout(() => setGuideSaved(false), 2000)
  }

  // The first three reuse the employee's own labels, so the sections are
  // named the same on both sides of the app.
  const taskSectionLabels: Record<TaskSection, string> = {
    today: t('mytasks_today'),
    week: t('mytasks_thisWeek'),
    month: t('mytasks_thisMonth'),
    all: t('profile_tabAllTasks'),
  }

  const tabLabels: Record<Tab, string> = {
    tasks: t('profile_tabTasks'),
    analytics: t('profile_tabAnalytics'),
    worklog: t('nav_workLog'),
    todos: t('nav_todos'),
    calendar: t('nav_calendar'),
    notes: t('nav_notes'),
    toolbox: t('profile_tabToolbox'),
    guidelines: t('profile_tabGuidelines'),
  }

  // Their own lists and board, read-only: an owner can see how their team is
  // organising itself without being able to reorganise it for them.
  const empProject = emp.projectId ? getProject(emp.projectId) : undefined

  const tabCls = (tab_: Tab) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      tab === tab_
        ? 'border-primary text-primary'
        : 'border-transparent text-text-muted hover:text-text-main'
    }`

  return (
    <div className="animate-fade-in">
      <button
        onClick={() => navigate(backTo)}
        className="flex items-center gap-1.5 text-text-muted text-sm hover:text-text-main mb-5 transition-colors"
      >
        <ArrowLeft size={15} /> {t('profile_backToEmployees')}
      </button>

      <div className="bg-surface rounded-xl border border-border p-5 mb-5">
        <div className="flex items-start gap-4 flex-wrap">
          <Avatar id={emp.id} initials={emp.avatarInitials} name={emp.name} size={64} />
          <div className="flex-1 min-w-[12rem]">
            <h2 className="text-text-main font-bold text-lg">{emp.name}</h2>
            <p className="text-text-muted text-sm">{emp.jobTitle} · {emp.department}</p>
            <p className="text-text-subtle text-xs mt-1">{emp.email}</p>
            <p className="text-text-subtle text-xs">{t('profile_joined')} {format(parseISO(emp.joinDate), 'EEE d MMM yyyy', dateLocale)}</p>
          </div>

          {/* Their whole side of FlowDesk, exactly as they see it — not a
              read-only imitation of it. The tabs on this page each show one
              slice through a manager's lens; this is the app itself, so what
              you are looking at cannot drift from what they are looking at.
              Owner-only, because it is a way into somebody else's workspace.
              Nothing done in there is recorded as them being at work: the
              session tracking is keyed on the real account. */}
          {isOwner && (
            <button
              onClick={() => {
                // Where to come back to: this page, as it is now.
                setViewAs(emp, location.pathname + location.search)
                navigate('/employee/tasks')
              }}
              className="flex items-center gap-2 bg-primary text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-primary-dark transition-colors flex-shrink-0"
              title={t('viewas_buttonHint')}
            >
              <Eye size={16} />
              {t('viewas_button').replace('{name}', emp.name.split(' ')[0])}
            </button>
          )}
        </div>
      </div>

      {/* Eight tabs wrap on a phone rather than running off the edge; a
          row that scrolled sideways was what let the whole page scroll
          sideways. */}
      <div className="border-b border-border flex flex-wrap gap-0 mb-6">
        {TABS.map(tab_ => (
          <button key={tab_} onClick={() => setTab(tab_)} className={tabCls(tab_)}>
            {tabLabels[tab_]}
          </button>
        ))}
      </div>

      {/* Their work in the same four cuts, in the same order: today, this
          week, this month, then everything. The first three are the very
          component the employee looks at, one period at a time, so what a
          manager sees of somebody's day is that person's actual day rather
          than a second, differently-shaped summary that can quietly disagree
          with it. The fourth is the task manager that was here already.

          All four are editable. They were read-only, on the reasoning that a
          stray click should not tick off somebody else's work — but that made
          the view something to look at and nothing to act on, and a manager
          who watched the work happen had to go elsewhere to record it. The
          completion is written against the employee, not the manager, which
          is what marking somebody's work done should mean. RLS allows it:
          completion_logs and task_statuses both let is_admin() write any
          row. */}
      {tab === 'tasks' && (
        <div>
          <div className="flex items-center gap-1 mb-5 flex-wrap">
            {TASK_SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setTaskSection(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  taskSection === s
                    ? 'bg-primary text-white'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-2'
                }`}
              >
                {taskSectionLabels[s]}
              </button>
            ))}
          </div>

          {taskSection === 'all' ? (
            <TaskManager preselectedEmployee={emp.id} />
          ) : (
            <MyTasks employeeId={emp.id} section={taskSection} manage />
          )}
        </div>
      )}

      {tab === 'analytics' && (
        <div className="space-y-4">
          {/* Owner-only, and renders nothing for anyone else. */}
          <AppUsagePanel employeeId={emp.id} />
          <Analytics forEmployeeId={emp.id} />
        </div>
      )}

      {tab === 'worklog' && (
        !empProject ? (
          <p className="text-text-muted text-sm py-8">{t('profile_notOnProject')}</p>
        ) : (
          // Read-only: this is their record of their own work, and a manager
          // reads it rather than writes into it.
          <WorkLog project={empProject} authorId={emp.id} readOnly />
        )
      )}

      {/* Their week, exactly as they see it: the same CalendarBoard on the
          same board (project + their own owner id), so assigned work is the
          filled purple block and their own todos are the outlined one. Rendering
          anything else here would be a second, differently coloured calendar
          claiming to be theirs.

          Editable, unlike their work log and notes. A manager reschedules
          work and ticks off what they watched get done, and having to leave
          for the task manager to move a single day made this something to
          look at rather than something to work from. */}
      {tab === 'calendar' && (
        !empProject ? (
          <p className="text-text-muted text-sm py-8">{t('profile_notOnProject')}</p>
        ) : (
          <CalendarBoard
            project={empProject}
            ownerId={emp.id}
            basePath={`/admin/projects/${empProject.id}`}
          />
        )
      )}

      {(tab === 'todos' || tab === 'notes') && (
        !empProject ? (
          <p className="text-text-muted text-sm py-8">
            {emp.name} is not on a project yet, so there is nothing here.
          </p>
        ) : tab === 'todos' ? (
          <TodoBoard
            project={empProject}
            ownerId={emp.id}
            basePath={`/admin/projects/${empProject.id}`}
            readOnly
            emptyDescription={`${emp.name} has not added anything to this list.`}
          />
        ) : (
          <NoteBoard project={empProject} ownerId={emp.id} readOnly />
        )
      )}

      {tab === 'toolbox' && (
        <div className="space-y-5">
          <div>
            <h3 className="text-text-main font-semibold text-sm mb-3">{t('profile_assignedWebsites')}</h3>
            {empWebsites.length === 0 ? (
              <EmptyState icon={Globe} title={t('profile_noWebsites')} description={t('profile_noWebsitesDesc')} />
            ) : (
              // The same icon grid the employee sees in their own Toolbox:
              // this is a view of their tools, so it should look like their
              // tools rather than a different list of the same sites. The
              // owner can edit and remove them here, as they can in theirs.
              <WebsiteGrid sites={empWebsites} employeeId={emp.id} canManage={isOwner} />
            )}
          </div>
        </div>
      )}

      {tab === 'guidelines' && (
        <div>
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="flex items-center gap-1 p-2 border-b border-border flex-wrap">
              {[
                { icon: <Bold size={14} />, action: () => editor?.chain().focus().toggleBold().run(), label: t('profile_bold') },
                { icon: <Italic size={14} />, action: () => editor?.chain().focus().toggleItalic().run(), label: t('profile_italic') },
                { icon: <Heading2 size={14} />, action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), label: t('profile_h2') },
                { icon: <List size={14} />, action: () => editor?.chain().focus().toggleBulletList().run(), label: t('profile_list') },
                { icon: <ListOrdered size={14} />, action: () => editor?.chain().focus().toggleOrderedList().run(), label: t('profile_numbered') },
              ].map(btn => (
                <button
                  key={btn.label}
                  onClick={btn.action}
                  className="p-1.5 rounded hover:bg-surface-2 text-text-muted hover:text-text-main transition-colors"
                  title={btn.label}
                >
                  {btn.icon}
                </button>
              ))}
            </div>
            <div className="tiptap-content">
              <EditorContent editor={editor} />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={handleSaveGuide}
              className="bg-primary text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-primary-dark transition-colors"
            >
              {t('profile_saveGuidelines')}
            </button>
            {guidelines?.updatedAt && (
              <span className="text-text-subtle text-xs">
                {t('profile_lastUpdated')} {format(parseISO(guidelines.updatedAt), 'EEE d MMM yyyy HH:mm', dateLocale)}
              </span>
            )}
            {guideSaved && <span className="text-success text-xs font-medium">{t('profile_saved')}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
