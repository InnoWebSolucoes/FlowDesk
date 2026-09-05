import React, { useState } from 'react'
import { Sparkles, Loader2, Download, AlertCircle, Clock, ChevronDown, ChevronUp, Wand2 } from 'lucide-react'
import { generateTasks } from '../../lib/anthropic'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { useAuthStore } from '../../store/authStore'
import { Task } from '../../types'
import { Badge } from '../../components/shared/Badge'
import { EmptyState } from '../../components/shared/EmptyState'
import { useT } from '../../i18n/useT'

interface GeneratedTask {
  title: string
  description: string
  frequency: any
  categoryName: string
  priority: 'low' | 'medium' | 'high'
  /** '' only while being typed; 0 means no estimate. */
  estimatedMinutes: number | ''
  _categoryId?: string
  /**
   * Who this particular task goes to. The AI proposes names it can infer from
   * the description; the manager can change any of them. Falls back to the
   * batch selection when it has no opinion.
   */
  _assignedTo?: string[]
  /** Names the model suggested, resolved to ids on arrival. */
  suggestedAssignees?: string[]
}

export function AIOrganiser() {
  const { tasks, categories, addTask, addCategory } = useTaskStore()
  const { employees } = useEmployeeStore()
  const { currentUser } = useAuthStore()
  const { t } = useT()

  const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  function freqLabel(freq: any): string {
    if (!freq) return '-'
    if (freq.type === 'daily') return t('task_freqDaily') + ' (Mon-Fri)'
    if (freq.type === 'weekly') {
      const days = (freq.days ?? []).map((d: number) => DAY_NAMES_EN[d]).join(', ')
      return `${t('task_freqWeekly')}: ${days}`
    }
    if (freq.type === 'monthly') return `${t('task_freqMonthly')}: ${t('task_week')} ${freq.weekOfMonth}, ${DAY_NAMES_EN[freq.dayOfWeek ?? 1]}`
    if (freq.type === 'one-off') return `${t('task_freqOneOff')}: ${freq.date ?? ''}`
    return freq.type
  }

  const [description, setDescription] = useState('')
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [generated, setGenerated] = useState<GeneratedTask[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [imported, setImported] = useState(false)
  const [refinement, setRefinement] = useState('')
  const [refining, setRefining] = useState(false)

  const toggleEmployee = (id: string) => {
    setSelectedEmployees(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    )
  }

  const toggleExpand = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const handleGenerate = async () => {
    if (!description.trim()) { setError(t('ai_errorEmpty')); return }
    setError('')
    setLoading(true)
    setImported(false)
    setGenerated([])
    try {
      const result = await generateTasks(description)
      if (!Array.isArray(result)) throw new Error('Invalid response format')
      setGenerated(result.map(withSuggested))
    } catch (e: any) {
      setError(e.message?.includes('API')
        ? t('ai_errorApi')
        : `${t('ai_errorGeneration')} ${e.message ?? 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  // Sends the batch back with the manager's corrections applied. The tasks
  // aren't in the database yet, so revising is just replacing local state.
  const handleRefine = async () => {
    if (!refinement.trim()) { setError(t('ai_errorRefineEmpty')); return }
    setError('')
    setRefining(true)
    try {
      const result = await generateTasks(refinement, generated)
      if (!Array.isArray(result)) throw new Error('Invalid response format')
      // Category choices the manager already made are per-index and don't
      // survive a reshuffle, so let them resolve again from categoryName.
      setGenerated(result.map(({ _categoryId, ...task }: GeneratedTask) => withSuggested(task)))
      setExpanded(new Set())
      setRefinement('')
    } catch (e: any) {
      setError(`${t('ai_errorGeneration')} ${e.message ?? 'Unknown error'}`)
    } finally {
      setRefining(false)
    }
  }

  /**
   * Turn the model's suggested names into real employee ids. It only ever sees
   * names, and matching is loose because it will not reproduce them exactly.
   */
  const withSuggested = (task: GeneratedTask): GeneratedTask => {
    if (task._assignedTo?.length) return task
    const names = task.suggestedAssignees ?? []
    const ids = names
      .map((n) => {
        const needle = n.trim().toLowerCase()
        return employees.find(
          (e) =>
            e.name.toLowerCase() === needle ||
            e.name.toLowerCase().startsWith(needle) ||
            needle.startsWith(e.name.toLowerCase().split(' ')[0]),
        )?.id
      })
      .filter((id): id is string => !!id)

    return { ...task, _assignedTo: ids.length ? ids : selectedEmployees }
  }

  const setTaskAssignees = (index: number, ids: string[]) =>
    setGenerated((g) => g.map((t, i) => (i === index ? { ...t, _assignedTo: ids } : t)))

  const resolveCategory = async (name: string): Promise<string> => {
    const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase())
    if (existing) return existing.id
    const colors = ['#1A5C3A', '#1B4F8A', '#7A4A0A', '#7A2020', '#3A2A7A', '#2A5C1E']
    const newCat = await addCategory({ name, color: colors[categories.length % colors.length] })
    return newCat.id
  }

  const handleImportAll = async () => {
    if (!currentUser) return

    for (const gt of generated) {
      // Each task carries its own people now, so a single batch can be split
      // across the team rather than all landing on the same person.
      const assignees = gt._assignedTo?.length ? gt._assignedTo : selectedEmployees
      if (assignees.length === 0) continue

      // An employee belongs to exactly one project, so the assignees fix it.
      const projectId = employees.find(e => e.id === assignees[0])?.projectId
      if (!projectId) continue

      const catId = gt._categoryId ?? await resolveCategory(gt.categoryName)
      const task: Omit<Task, 'id' | 'createdAt'> = {
        projectId,
        title: gt.title,
        description: gt.description,
        assignedTo: assignees,
        frequency: gt.frequency,
        categoryId: catId,
        priority: gt.priority,
        estimatedMinutes: Number(gt.estimatedMinutes) || 0,
        deadline: null,
        schedules: [],
        createdBy: currentUser.id,
        isActive: true,
      }
      await addTask(task)
    }
    setImported(true)
    setTimeout(() => setImported(false), 3000)
  }

  const updateGenerated = (i: number, key: string, value: any) => {
    setGenerated(prev => prev.map((item, idx) => idx === i ? { ...item, [key]: value } : item))
  }

  const priorityLabel = (p: string) => {
    if (p === 'low') return t('ai_priorityLow')
    if (p === 'medium') return t('ai_priorityMedium')
    if (p === 'high') return t('ai_priorityHigh')
    return p
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 animate-fade-in" style={{ minHeight: '70vh' }}>
      {/* Left panel */}
      <div className="lg:w-2/5 flex-shrink-0 space-y-4">
        <div className="bg-surface rounded-xl border border-border p-5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={18} className="text-primary" />
            <h2 className="text-text-main font-semibold text-base">{t('ai_title')}</h2>
          </div>
          <p className="text-text-muted text-sm mb-4">{t('ai_description')}</p>

          <textarea
            className="w-full border border-border rounded-lg px-3 py-3 text-sm text-text-main bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none"
            rows={8}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('ai_placeholder')}
          />

          <div className="mt-4">
            <p className="text-text-main text-xs font-medium mb-2">{t('ai_assignTo')}</p>
            <div className="flex flex-wrap gap-2">
              {employees.map(emp => (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => toggleEmployee(emp.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    selectedEmployees.includes(emp.id)
                      ? 'bg-primary text-white border-primary'
                      : 'bg-surface text-text-muted border-border hover:border-primary/50'
                  }`}
                >
                  {emp.name}
                </button>
              ))}
              {employees.length === 0 && (
                <p className="text-text-muted text-xs">{t('ai_noEmployees')}</p>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 bg-danger-bg border border-danger/20 rounded-lg px-3 py-2.5 text-danger text-xs">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="mt-4 w-full flex items-center justify-center gap-2 bg-primary text-white font-medium py-2.5 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm"
          >
            {loading ? (
              <><Loader2 size={16} className="animate-spin" /> {t('ai_generating')}</>
            ) : (
              <><Sparkles size={16} /> {t('ai_generateBtn')}</>
            )}
          </button>
        </div>

        {/* Refinement: only useful once there's a batch to revise. */}
        {generated.length > 0 && (
          <div className="bg-surface rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-2">
              <Wand2 size={16} className="text-primary" />
              <h3 className="text-text-main font-semibold text-sm">{t('ai_refineTitle')}</h3>
            </div>
            <p className="text-text-muted text-xs mb-3">{t('ai_refineHint')}</p>

            <textarea
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text-main bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none"
              rows={4}
              value={refinement}
              onChange={e => setRefinement(e.target.value)}
              placeholder={t('ai_refinePlaceholder')}
            />

            <button
              onClick={handleRefine}
              disabled={refining || loading}
              className="mt-3 w-full flex items-center justify-center gap-2 bg-surface text-text-main font-medium py-2.5 rounded-lg border border-border hover:border-primary/50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm"
            >
              {refining ? (
                <><Loader2 size={16} className="animate-spin" /> {t('ai_refining')}</>
              ) : (
                <><Wand2 size={16} /> {t('ai_refineBtn')}</>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="flex-1 min-w-0">
        {generated.length === 0 && !loading && (
          <EmptyState
            icon={Sparkles}
            title={t('ai_emptyTitle')}
            description={t('ai_emptyDesc')}
          />
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 size={28} className="animate-spin text-primary" />
            <p className="text-text-muted text-sm">{t('ai_analysing')}</p>
          </div>
        )}

        {generated.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-text-muted text-sm">{generated.length} {t('ai_tasksGenerated')}</p>
              {imported && (
                <span className="text-success text-sm font-medium">{t('ai_allImported')}</span>
              )}
            </div>

            {generated.map((gt, i) => {
              const cat = categories.find(c => c.name.toLowerCase() === gt.categoryName.toLowerCase())
              const isOpen = expanded.has(i)
              return (
                <div key={i} className="bg-surface rounded-xl border border-border overflow-hidden">
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-surface-2/40 transition-colors"
                    onClick={() => toggleExpand(i)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-main">{gt.title}</span>
                        <Badge
                          label={gt.categoryName}
                          color={cat?.color ?? '#6B6960'}
                          size="sm"
                        />
                        <span className={`text-xs font-medium ${
                          gt.priority === 'high' ? 'text-danger' :
                          gt.priority === 'medium' ? 'text-amber' : 'text-success'
                        }`}>{priorityLabel(gt.priority)}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-text-subtle">{freqLabel(gt.frequency)}</span>
                        {Number(gt.estimatedMinutes) > 0 && (
                          <span className="flex items-center gap-1 text-xs text-text-subtle">
                            <Clock size={10} /> {gt.estimatedMinutes}m
                          </span>
                        )}
                      </div>
                    </div>
                    {isOpen ? <ChevronUp size={15} className="text-text-subtle flex-shrink-0" /> : <ChevronDown size={15} className="text-text-subtle flex-shrink-0" />}
                  </div>

                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-border space-y-3 pt-3">
                      <div>
                        <label className="text-xs font-medium text-text-muted mb-1 block">{t('ai_titleLabel')}</label>
                        <input
                          className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text-main bg-surface focus:outline-none focus:border-primary"
                          value={gt.title}
                          onChange={e => updateGenerated(i, 'title', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-muted mb-1 block">{t('ai_descriptionLabel')}</label>
                        <textarea
                          className="w-full border border-border rounded-lg px-3 py-2 text-sm text-text-main bg-surface focus:outline-none focus:border-primary resize-none"
                          rows={3}
                          value={gt.description}
                          onChange={e => updateGenerated(i, 'description', e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-text-muted mb-1 block">{t('ai_priorityLabel')}</label>
                          <select
                            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface focus:outline-none focus:border-primary"
                            value={gt.priority}
                            onChange={e => updateGenerated(i, 'priority', e.target.value)}
                          >
                            <option value="low">{t('ai_priorityLow')}</option>
                            <option value="medium">{t('ai_priorityMedium')}</option>
                            <option value="high">{t('ai_priorityHigh')}</option>
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="text-xs font-medium text-text-muted mb-1 block">{t('ai_assignThisTask')}</label>
                          <div className="flex flex-wrap gap-1.5">
                            {employees.map(emp => {
                              const picked = (gt._assignedTo ?? []).includes(emp.id)
                              const noProject = !emp.projectId
                              return (
                                <button
                                  key={emp.id}
                                  type="button"
                                  disabled={noProject}
                                  title={noProject ? `${emp.name} is not on a project yet` : undefined}
                                  onClick={() =>
                                    setTaskAssignees(
                                      i,
                                      picked
                                        ? (gt._assignedTo ?? []).filter(id => id !== emp.id)
                                        : [...(gt._assignedTo ?? []), emp.id],
                                    )
                                  }
                                  className={`px-2 py-1 rounded-full text-[11px] font-medium border transition-all ${
                                    noProject
                                      ? 'bg-surface-2 text-text-subtle border-border cursor-not-allowed opacity-60'
                                      : picked
                                        ? 'bg-primary text-white border-primary'
                                        : 'bg-surface text-text-muted border-border hover:border-primary/50'
                                  }`}
                                >
                                  {emp.name}
                                </button>
                              )
                            })}
                          </div>
                          {(gt._assignedTo ?? []).length === 0 && (
                            <p className="text-danger text-[11px] mt-1">{t('ai_assignNobody')}</p>
                          )}
                        </div>

                        <div>
                          <label className="text-xs font-medium text-text-muted mb-1 block">{t('ai_estMinutesLabel')}</label>
                          {/* Same as the task form: the raw value while you
                              type, so the last digit can actually be deleted,
                              and empty settles to "no estimate" on blur. */}
                          <input
                            type="number"
                            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface focus:outline-none focus:border-primary"
                            value={gt.estimatedMinutes === 0 ? '' : gt.estimatedMinutes}
                            min={0}
                            placeholder={t('task_estMinutesNone')}
                            onChange={e =>
                              updateGenerated(
                                i,
                                'estimatedMinutes',
                                e.target.value === '' ? '' : Number(e.target.value),
                              )
                            }
                            onBlur={e => {
                              const n = parseInt(e.target.value, 10)
                              updateGenerated(i, 'estimatedMinutes', Number.isFinite(n) && n > 0 ? n : 0)
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            <button
              onClick={handleImportAll}
              className="w-full flex items-center justify-center gap-2 bg-primary text-white font-medium py-3 rounded-xl hover:bg-primary-dark transition-colors text-sm mt-2"
            >
              <Download size={16} /> {t('ai_importAll')} {generated.length} {t('ai_tasks')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
