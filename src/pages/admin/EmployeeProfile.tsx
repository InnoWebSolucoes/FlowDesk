import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Globe } from 'lucide-react'
import { useEmployeeStore } from '../../store/employeeStore'
import { useToolStore } from '../../store/toolStore'
import { useAuthStore } from '../../store/authStore'
import { TaskManager } from './TaskManager'
import { Analytics } from './Analytics'
import { AppUsagePanel } from '../../components/charts/AppUsagePanel'
import { EmptyState } from '../../components/shared/EmptyState'
import { faviconUrl, faviconLetter } from '../../lib/favicon'
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

export function EmployeeProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  // Unscoped: the profile renders outside the project shell, where the scoped
  // list has been cleared.
  const { allEmployees } = useEmployeeStore()
  const { websites, getGuidelines, saveGuidelines } = useToolStore()
  const { currentUser } = useAuthStore()
  const getProject = useProjectStore((s) => s.getProject)
  const { t, dateLocale } = useT()

  const [tab, setTab] = useState<Tab>('tasks')
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
        <div className="flex items-start gap-4">
          <Avatar id={emp.id} initials={emp.avatarInitials} name={emp.name} size={64} />
          <div className="flex-1">
            <h2 className="text-text-main font-bold text-lg">{emp.name}</h2>
            <p className="text-text-muted text-sm">{emp.jobTitle} · {emp.department}</p>
            <p className="text-text-subtle text-xs mt-1">{emp.email}</p>
            <p className="text-text-subtle text-xs">{t('profile_joined')} {format(parseISO(emp.joinDate), 'EEE d MMM yyyy', dateLocale)}</p>
          </div>
        </div>
      </div>

      <div className="border-b border-border flex gap-0 mb-6">
        {TABS.map(tab_ => (
          <button key={tab_} onClick={() => setTab(tab_)} className={tabCls(tab_)}>
            {tabLabels[tab_]}
          </button>
        ))}
      </div>

      {tab === 'tasks' && (
        <TaskManager preselectedEmployee={emp.id} />
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
          claiming to be theirs. Read-only — their plan is theirs to change. */}
      {tab === 'calendar' && (
        !empProject ? (
          <p className="text-text-muted text-sm py-8">{t('profile_notOnProject')}</p>
        ) : (
          <CalendarBoard
            project={empProject}
            ownerId={emp.id}
            basePath={`/admin/projects/${empProject.id}`}
            readOnly
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
              // tools rather than a different list of the same sites.
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                {empWebsites.map(w => (
                  <a
                    key={w.id}
                    href={w.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={w.description || w.url}
                    className="group flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-surface-2 transition-colors"
                  >
                    <img
                      src={faviconUrl(w.url)}
                      alt=""
                      className="w-10 h-10 rounded-xl object-contain bg-surface border border-border p-1.5 shadow-sm group-hover:shadow transition-shadow"
                      onError={e => {
                        const img = e.target as HTMLImageElement
                        img.style.display = 'none'
                        img.nextElementSibling?.classList.remove('hidden')
                      }}
                    />
                    <span className="hidden w-10 h-10 rounded-xl bg-primary-light border border-border shadow-sm items-center justify-center text-primary font-semibold">
                      {faviconLetter(w.name || w.url)}
                    </span>
                    <span className="text-text-main text-xs text-center leading-tight line-clamp-2 w-full">
                      {w.name}
                    </span>
                  </a>
                ))}
              </div>
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
