import React, { useState, useMemo } from 'react'
import { Plus, Search, Pencil, Trash2, X, Check, ListTodo } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { Task, TaskFrequency, Priority, Category, FrequencyType } from '../../types'
import { Badge } from '../../components/shared/Badge'
import { EmptyState } from '../../components/shared/EmptyState'
import { format } from 'date-fns'
import { useT } from '../../i18n/useT'

const PRIORITY_OPTIONS: Priority[] = ['low', 'medium', 'high']
const FREQ_OPTIONS: FrequencyType[] = ['daily', 'weekly', 'monthly', 'one-off']

const defaultFreq = (): TaskFrequency => ({ type: 'daily' })
const defaultTask = (): Omit<Task, 'id' | 'createdAt' | 'createdBy'> => ({
  title: '',
  description: '',
  assignedTo: [],
  frequency: defaultFreq(),
  categoryId: '',
  priority: 'medium',
  estimatedMinutes: 30,
  isActive: true,
})

function TaskForm({
  initial,
  onSave,
  onCancel,
  categories,
  employees,
  onAddCategory,
}: {
  initial?: Task
  onSave: (data: any) => void
  onCancel: () => void
  categories: Category[]
  employees: import('../../types').Employee[]
  onAddCategory: (cat: Category) => void
}) {
  const { t } = useT()
  const DAY_NAMES = [t('task_sun'), t('task_mon'), t('task_tue'), t('task_wed'), t('task_thu'), t('task_fri'), t('task_sat')]

  const [form, setForm] = useState<any>(
    initial
      ? { ...initial }
      : { ...defaultTask(), categoryId: categories[0]?.id ?? '' }
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor, setNewCatColor] = useState('#1A5C3A')
  const [showCatForm, setShowCatForm] = useState(false)

  const set = (key: string, value: any) => setForm((f: any) => ({ ...f, [key]: value }))
  const setFreq = (key: string, value: any) =>
    setForm((f: any) => ({ ...f, frequency: { ...f.frequency, [key]: value } }))

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.title.trim()) e.title = t('task_errorTitle')
    if (!form.categoryId) e.categoryId = t('task_errorCategory')
    if (form.assignedTo.length === 0) e.assignedTo = t('task_errorAssign')
    if (form.estimatedMinutes < 1) e.estimatedMinutes = t('task_errorMinutes')
    if (form.frequency.type === 'weekly' && (!form.frequency.days || form.frequency.days.length === 0))
      e.days = t('task_errorDays')
    if (form.frequency.type === 'one-off' && !form.frequency.date) e.date = t('task_errorDate')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = () => {
    if (!validate()) return
    onSave(form)
  }

  const toggleDay = (day: number) => {
    const days = form.frequency.days ?? []
    if (days.includes(day)) setFreq('days', days.filter((d: number) => d !== day))
    else setFreq('days', [...days, day].sort())
  }

  const toggleEmployee = (id: string) => {
    const curr = form.assignedTo
    if (curr.includes(id)) set('assignedTo', curr.filter((e: string) => e !== id))
    else set('assignedTo', [...curr, id])
  }

  const handleAddCategory = () => {
    if (!newCatName.trim()) return
    const cat: Category = { id: uuidv4(), name: newCatName.trim(), color: newCatColor }
    onAddCategory(cat)
    set('categoryId', cat.id)
    setNewCatName('')
    setShowCatForm(false)
  }

  const inp = 'w-full border border-border rounded-lg px-3 py-2 text-sm text-text-main bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20'
  const lbl = 'block text-text-main text-xs font-medium mb-1'
  const err = (k: string) => errors[k] ? <p className="text-danger text-xs mt-0.5">{errors[k]}</p> : null

  const freqLabel = (type: string) => {
    if (type === 'daily') return t('task_freqDaily')
    if (type === 'weekly') return t('task_freqWeekly')
    if (type === 'monthly') return t('task_freqMonthly')
    if (type === 'one-off') return t('task_freqOneOff')
    return type
  }

  const priorityLabel = (p: string) => {
    if (p === 'low') return t('task_priorityLow')
    if (p === 'medium') return t('task_priorityMedium')
    if (p === 'high') return t('task_priorityHigh')
    return p
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-text-main font-semibold text-sm">{initial ? t('task_editTask') : t('task_newTask')}</h3>
        <button onClick={onCancel} className="text-text-subtle hover:text-text-muted"><X size={16} /></button>
      </div>

      <div>
        <label className={lbl}>{t('task_titleLabel')}</label>
        <input className={inp} value={form.title} onChange={e => set('title', e.target.value)} placeholder={t('task_titlePlaceholder')} />
        {err('title')}
      </div>

      <div>
        <label className={lbl}>{t('task_description')}</label>
        <textarea className={`${inp} resize-none`} rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder={t('task_descriptionPlaceholder')} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>{t('task_priority')}</label>
          <select className={inp} value={form.priority} onChange={e => set('priority', e.target.value)}>
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{priorityLabel(p)}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>{t('task_estMinutes')}</label>
          <input type="number" className={inp} value={form.estimatedMinutes} min={1}
            onChange={e => set('estimatedMinutes', parseInt(e.target.value) || 30)} />
          {err('estimatedMinutes')}
        </div>
      </div>

      <div>
        <label className={lbl}>{t('task_category')}</label>
        <div className="flex gap-2">
          <select className={`${inp} flex-1`} value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
            <option value="">{t('task_selectCategory')}</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" onClick={() => setShowCatForm(!showCatForm)}
            className="px-3 py-2 border border-border rounded-lg text-xs text-text-muted hover:bg-surface-2 transition-colors flex-shrink-0">
            {t('task_newCategory')}
          </button>
        </div>
        {err('categoryId')}
        {showCatForm && (
          <div className="mt-2 flex gap-2 items-center">
            <input className={`${inp} flex-1`} value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder={t('task_categoryName')} />
            <input type="color" value={newCatColor} onChange={e => setNewCatColor(e.target.value)} className="w-9 h-9 rounded border border-border cursor-pointer" />
            <button type="button" onClick={handleAddCategory} className="w-9 h-9 bg-primary text-white rounded-lg flex items-center justify-center">
              <Check size={14} />
            </button>
          </div>
        )}
      </div>

      <div>
        <label className={lbl}>{t('task_assignTo')}</label>
        <div className="flex flex-wrap gap-2">
          {employees.map(emp => (
            <button
              key={emp.id}
              type="button"
              onClick={() => toggleEmployee(emp.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                form.assignedTo.includes(emp.id)
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface text-text-muted border-border hover:border-primary/50'
              }`}
            >
              {emp.name}
            </button>
          ))}
        </div>
        {err('assignedTo')}
      </div>

      <div>
        <label className={lbl}>{t('task_frequency')}</label>
        <select className={inp} value={form.frequency.type}
          onChange={e => set('frequency', { type: e.target.value as FrequencyType })}>
          {FREQ_OPTIONS.map(f => <option key={f} value={f}>{freqLabel(f)}</option>)}
        </select>

        {form.frequency.type === 'weekly' && (
          <div className="mt-2">
            <p className="text-xs text-text-muted mb-1.5">{t('task_selectDays')}</p>
            <div className="flex gap-1.5 flex-wrap">
              {[1, 2, 3, 4, 5, 6, 0].map(d => (
                <button key={d} type="button" onClick={() => toggleDay(d)}
                  className={`w-9 h-8 rounded-lg text-xs font-medium border transition-all ${
                    (form.frequency.days ?? []).includes(d)
                      ? 'bg-primary text-white border-primary'
                      : 'bg-surface text-text-muted border-border hover:border-primary/50'
                  }`}>
                  {DAY_NAMES[d]}
                </button>
              ))}
            </div>
            {err('days')}
          </div>
        )}

        {form.frequency.type === 'monthly' && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-text-muted mb-1">{t('task_weekOfMonth')}</p>
              <select className={inp} value={form.frequency.weekOfMonth ?? 1}
                onChange={e => setFreq('weekOfMonth', parseInt(e.target.value))}>
                {[1,2,3,4].map(w => <option key={w} value={w}>{t('task_week')} {w}</option>)}
              </select>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">{t('task_dayOfWeek')}</p>
              <select className={inp} value={form.frequency.dayOfWeek ?? 1}
                onChange={e => setFreq('dayOfWeek', parseInt(e.target.value))}>
                {[1,2,3,4,5].map(d => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
              </select>
            </div>
          </div>
        )}

        {form.frequency.type === 'one-off' && (
          <div className="mt-2">
            <input type="date" className={inp} value={form.frequency.date ?? ''}
              onChange={e => setFreq('date', e.target.value)} min={format(new Date(), 'yyyy-MM-dd')} />
            {err('date')}
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={handleSave}
          className="flex-1 bg-primary text-white text-sm font-medium py-2.5 rounded-lg hover:bg-primary-dark transition-colors">
          {initial ? t('task_saveChanges') : t('task_createTask')}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2.5 border border-border text-text-muted text-sm rounded-lg hover:bg-surface-2 transition-colors">
          {t('task_cancel')}
        </button>
      </div>
    </div>
  )
}

export function TaskManager({ preselectedEmployee }: { preselectedEmployee?: string }) {
  const { tasks, categories, addTask, updateTask, deleteTask, addCategory } = useTaskStore()
  const { employees } = useEmployeeStore()
  const { t } = useT()

  const DAY_NAMES = [t('task_sun'), t('task_mon'), t('task_tue'), t('task_wed'), t('task_thu'), t('task_fri'), t('task_sat')]

  const [search, setSearch] = useState('')
  const [filterEmp, setFilterEmp] = useState(preselectedEmployee ?? '')
  const [filterCat, setFilterCat] = useState('')
  const [filterFreq, setFilterFreq] = useState('')
  const [filterPri, setFilterPri] = useState('')
  const [sortCol, setSortCol] = useState<string>('title')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Task | null | 'new'>(null)

  const PAGE_SIZE = 20

  const filtered = useMemo(() => {
    return tasks
      .filter(task => {
        if (search && !task.title.toLowerCase().includes(search.toLowerCase())) return false
        if (filterEmp && !task.assignedTo.includes(filterEmp)) return false
        if (filterCat && task.categoryId !== filterCat) return false
        if (filterFreq && task.frequency.type !== filterFreq) return false
        if (filterPri && task.priority !== filterPri) return false
        return true
      })
      .sort((a, b) => {
        let va: any = a[sortCol as keyof Task]
        let vb: any = b[sortCol as keyof Task]
        if (typeof va === 'string') va = va.toLowerCase()
        if (typeof vb === 'string') vb = vb.toLowerCase()
        if (va < vb) return sortDir === 'asc' ? -1 : 1
        if (va > vb) return sortDir === 'asc' ? 1 : -1
        return 0
      })
  }, [tasks, search, filterEmp, filterCat, filterFreq, filterPri, sortCol, sortDir])

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const handleSave = (data: any) => {
    if (editing === 'new') {
      addTask({ ...data, id: uuidv4(), createdAt: new Date().toISOString(), createdBy: 'admin-1' })
    } else if (editing) {
      updateTask(editing.id, data)
    }
    setEditing(null)
  }

  const handleDelete = (id: string) => {
    if (confirm(t('task_deleteConfirm'))) deleteTask(id)
  }

  const freqLabel = (task: Task) => {
    const f = task.frequency
    if (f.type === 'daily') return t('task_freqDaily')
    if (f.type === 'weekly') return `${t('task_freqWeekly')} (${(f.days ?? []).map(d => DAY_NAMES[d]).join(', ')})`
    if (f.type === 'monthly') return `${t('task_freqMonthly')} (${t('task_week')} ${f.weekOfMonth}, ${DAY_NAMES[f.dayOfWeek ?? 1]})`
    if (f.type === 'one-off') return `${t('task_freqOneOff')} (${f.date ?? ''})`
    return f.type
  }

  const priorityLabel = (p: string) => {
    if (p === 'low') return t('task_priorityLow')
    if (p === 'medium') return t('task_priorityMedium')
    if (p === 'high') return t('task_priorityHigh')
    return p
  }

  const freqOptionLabel = (f: string) => {
    if (f === 'daily') return t('task_freqDaily')
    if (f === 'weekly') return t('task_freqWeekly')
    if (f === 'monthly') return t('task_freqMonthly')
    if (f === 'one-off') return t('task_freqOneOff')
    return f
  }

  const Th = ({ label, col }: { label: string; col?: string }) => (
    <th
      className={`text-left text-text-muted font-medium py-2 px-3 text-xs ${col ? 'cursor-pointer hover:text-text-main select-none' : ''}`}
      onClick={col ? () => handleSort(col) : undefined}
    >
      {label} {col && sortCol === col && (sortDir === 'asc' ? '↑' : '↓')}
    </th>
  )

  return (
    <div className="flex flex-col lg:flex-row gap-6 animate-fade-in">
      <div className="flex-1 min-w-0">
        <div className="bg-surface rounded-xl border border-border p-4 mb-4">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-44">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle" />
              <input
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:border-primary"
                placeholder={t('task_searchPlaceholder')}
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0) }}
              />
            </div>
            <select className="border border-border rounded-lg px-3 py-2 text-sm text-text-muted bg-surface focus:outline-none focus:border-primary"
              value={filterEmp} onChange={e => { setFilterEmp(e.target.value); setPage(0) }}>
              <option value="">{t('task_allEmployees')}</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <select className="border border-border rounded-lg px-3 py-2 text-sm text-text-muted bg-surface focus:outline-none focus:border-primary"
              value={filterCat} onChange={e => { setFilterCat(e.target.value); setPage(0) }}>
              <option value="">{t('task_allCategories')}</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="border border-border rounded-lg px-3 py-2 text-sm text-text-muted bg-surface focus:outline-none focus:border-primary"
              value={filterFreq} onChange={e => { setFilterFreq(e.target.value); setPage(0) }}>
              <option value="">{t('task_allFrequencies')}</option>
              {FREQ_OPTIONS.map(f => <option key={f} value={f}>{freqOptionLabel(f)}</option>)}
            </select>
            <select className="border border-border rounded-lg px-3 py-2 text-sm text-text-muted bg-surface focus:outline-none focus:border-primary"
              value={filterPri} onChange={e => { setFilterPri(e.target.value); setPage(0) }}>
              <option value="">{t('task_allPriorities')}</option>
              {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{priorityLabel(p)}</option>)}
            </select>
            <button
              onClick={() => setEditing('new')}
              className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors flex-shrink-0"
            >
              <Plus size={15} /> {t('task_newTask')}
            </button>
          </div>
        </div>

        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {paginated.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title={t('task_noTasksFound')}
              description={t('task_noTasksDesc')}
              action={
                <button onClick={() => setEditing('new')}
                  className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark">
                  <Plus size={14} /> {t('task_createTask')}
                </button>
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-bg/40">
                      <Th label={t('task_colTask')} col="title" />
                      <Th label={t('task_colAssigned')} />
                      <Th label={t('task_colFrequency')} col="frequency" />
                      <Th label={t('task_colCategory')} col="categoryId" />
                      <Th label={t('task_colPriority')} col="priority" />
                      <Th label={t('task_colTime')} col="estimatedMinutes" />
                      <Th label="" />
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(task => {
                      const cat = categories.find(c => c.id === task.categoryId)
                      const assignedNames = task.assignedTo
                        .map(id => employees.find(e => e.id === id)?.name?.split(' ')[0] ?? id)
                        .join(', ')
                      return (
                        <tr key={task.id} className="border-b border-border/50 hover:bg-surface-2/40 transition-colors">
                          <td className="py-2.5 px-3 font-medium text-text-main max-w-xs">
                            <span className="line-clamp-1">{task.title}</span>
                          </td>
                          <td className="py-2.5 px-3 text-text-muted text-xs">{assignedNames}</td>
                          <td className="py-2.5 px-3 text-text-muted text-xs whitespace-nowrap">{freqLabel(task)}</td>
                          <td className="py-2.5 px-3">
                            {cat && <Badge label={cat.name} color={cat.color} size="sm" />}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`text-xs font-medium ${
                              task.priority === 'high' ? 'text-danger' :
                              task.priority === 'medium' ? 'text-amber' : 'text-success'
                            }`}>
                              {priorityLabel(task.priority)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-text-muted text-xs">{task.estimatedMinutes}m</td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1">
                              <button onClick={() => setEditing(task)}
                                className="p-1.5 rounded hover:bg-surface-2 text-text-subtle hover:text-text-main transition-colors">
                                <Pencil size={13} />
                              </button>
                              <button onClick={() => handleDelete(task.id)}
                                className="p-1.5 rounded hover:bg-danger-bg text-text-subtle hover:text-danger transition-colors">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-text-muted">{filtered.length} {t('task_tasks')}</span>
                  <div className="flex gap-1">
                    {Array.from({ length: totalPages }).map((_, i) => (
                      <button key={i} onClick={() => setPage(i)}
                        className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                          page === i ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface-2'
                        }`}>
                        {i + 1}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="lg:w-96 flex-shrink-0">
          <TaskForm
            initial={editing === 'new' ? undefined : editing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
            categories={categories}
            employees={employees}
            onAddCategory={addCategory}
          />
        </div>
      )}
    </div>
  )
}
