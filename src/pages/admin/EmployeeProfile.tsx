import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Globe } from 'lucide-react'
import { useEmployeeStore } from '../../store/employeeStore'
import { useTaskStore } from '../../store/taskStore'
import { useToolStore } from '../../store/toolStore'
import { TaskManager } from './TaskManager'
import { Analytics } from './Analytics'
import { EmptyState } from '../../components/shared/EmptyState'
import { format, parseISO } from 'date-fns'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Italic, List, ListOrdered, Heading2 } from 'lucide-react'
import { useT } from '../../i18n/useT'

const TABS = ['tasks', 'analytics', 'toolbox', 'guidelines'] as const
type Tab = typeof TABS[number]

export function EmployeeProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { employees } = useEmployeeStore()
  const { tasks, categories, completionLogs } = useTaskStore()
  const { websites, getGuidelines, saveGuidelines } = useToolStore()
  const { t, dateLocale } = useT()

  const [tab, setTab] = useState<Tab>('tasks')
  const [guideSaved, setGuideSaved] = useState(false)

  const emp = employees.find(e => e.id === id)
  const guidelines = id ? getGuidelines(id) : undefined

  const editor = useEditor({
    extensions: [StarterKit],
    content: guidelines?.content ?? `<p>${t('profile_guidelinesPlaceholder')}</p>`,
  })

  if (!emp) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-text-muted mb-4">{t('profile_notFound')}</p>
        <button onClick={() => navigate('/admin/employees')} className="text-primary text-sm">{t('profile_back')}</button>
      </div>
    )
  }

  const empWebsites = websites.filter(w => w.assignedTo.includes(emp.id))

  const handleSaveGuide = () => {
    if (!editor || !id) return
    saveGuidelines(id, editor.getHTML(), 'admin-1')
    setGuideSaved(true)
    setTimeout(() => setGuideSaved(false), 2000)
  }

  const tabLabels: Record<Tab, string> = {
    tasks: t('profile_tabTasks'),
    analytics: t('profile_tabAnalytics'),
    toolbox: t('profile_tabToolbox'),
    guidelines: t('profile_tabGuidelines'),
  }

  const tabCls = (tab_: Tab) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      tab === tab_
        ? 'border-primary text-primary'
        : 'border-transparent text-text-muted hover:text-text-main'
    }`

  return (
    <div className="animate-fade-in">
      <button
        onClick={() => navigate('/admin/employees')}
        className="flex items-center gap-1.5 text-text-muted text-sm hover:text-text-main mb-5 transition-colors"
      >
        <ArrowLeft size={15} /> {t('profile_backToEmployees')}
      </button>

      <div className="bg-surface rounded-xl border border-border p-5 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-xl">{emp.avatarInitials}</span>
          </div>
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
        <Analytics forEmployeeId={emp.id} />
      )}

      {tab === 'toolbox' && (
        <div className="space-y-5">
          <div>
            <h3 className="text-text-main font-semibold text-sm mb-3">{t('profile_assignedWebsites')}</h3>
            {empWebsites.length === 0 ? (
              <EmptyState icon={Globe} title={t('profile_noWebsites')} description={t('profile_noWebsitesDesc')} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {empWebsites.map(w => (
                  <div key={w.id} className="bg-surface rounded-lg border border-border p-3 flex items-center gap-3">
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${w.url}&sz=32`}
                      alt=""
                      className="w-6 h-6 rounded flex-shrink-0"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-main">{w.name}</p>
                      <p className="text-xs text-text-subtle truncate">{w.url}</p>
                    </div>
                  </div>
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
