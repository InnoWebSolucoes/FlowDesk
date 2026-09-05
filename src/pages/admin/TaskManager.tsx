import React, { useState, useMemo } from 'react'
import { Plus, Search, Pencil, Trash2, X, Check, ListTodo } from 'lucide-react'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { useAuthStore } from '../../store/authStore'
import { Task, TaskFrequency, Priority, Category, FrequencyType } from '../../types'
import { Badge } from '../../components/shared/Badge'
import { EmptyState } from '../../components/shared/EmptyState'
import { format } from 'date-fns'
import { useT } from '../../i18n/useT'

const PRIORITY_OPTIONS: Priority[] = ['low', 'medium', 'high']
const FREQ_OPTIONS: FrequencyType[] = ['daily', 'weekly', 'monthly', 'one-off']

const defaultFreq = (): TaskFrequency => ({ type: 'daily' })
// projectId is derived from the assignees at save time, so it isn't part of the form.
const defaultTask = (): Omit<Task, 'id' | 'createdAt' | 'createdBy' | 'projectId'> => ({
  title: '',
  description: '',
  assignedTo: [],
  frequency: defaultFreq(),
  categoryId: '',
  priority: 'medium',
  estimatedMinutes: 30,
  // Optional: a recurring task often has no single date it must be done by,
  // and a manager may want the employee to choose. Empty is a real value.
  deadline: null,
  schedules: [],
  isActive: true,
})

function TaskForm({
  initial,
  onSave,
  onCancel,
  categories,
  employees,
  onAddCategory,
  defaultAssignee,
}: {
  initial?: Task
  onSave: (data: any) => void
  onCancel: () => void
  categories: Category[]
  employees: import('../../types').Employee[]
  onAddCategory: (cat: Omit<Category, 'id'>) => Promise<Category>
  /** Whose profile this was opened from, so the task starts assigned to them. */
  defaultAssignee?: string
}) {
  const { t } = useT()
  const DAY_NAMES = [t('task_sun'), t('task_mon'), t('task_tue'), t('task_wed'), t('task_thu'), t('task_fri'), t('task_sat')]

  const [form, setForm] = useState<any>(
    initial
      ? { ...initial }
      // Opened from an employee's profile, the task starts assigned to them.
      // The assignees decide the task's project, so leaving this empty is what
      // made "New Task" there fail with no project.
      : {
          ...defaultTask(),
          categoryId: categories[0]?.id ?? '',
          assignedTo: defaultAssignee ? [defaultAssignee] : [],
        }
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
    // An empty estimate is fine — not every task has a meaningful one. Only a
    // value that was typed and makes no sense is an error.
    const mins = form.estimatedMinutes === '' ? 0 : Number(form.estimatedMinutes)
    if (!Number.isFinite(mins) || mins < 0) e.estimatedMinutes = t('task_errorMinutes')
    if (form.frequency.type === 'weekly' && (!form.frequency.days || form.frequency.days.length === 0))
      e.days = t('task_errorDays')
    if (form.frequency.type === 'one-off' && !form.frequency.date) e.date = t('task_errorDate')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = () => {
    if (!validate()) return
    // '' is a typing state, not a value. 0 is how "no estimate" is stored.
    const mins = parseInt(String(form.estimatedMinutes), 10)
    onSave({ ...form, estimatedMinutes: Number.isFinite(mins) && mins > 0 ? mins : 0 })
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

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return
    const cat = await onAddCategory({ name: newCatName.trim(), color: newCatColor })
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
          {/* Kept as the raw string while you type. Parsing on every keystroke
              and falling back to a default meant clearing the box instantly
              refilled it, so the last digit could never be deleted. Empty is a
              real value here — the estimate is optional. */}
          <input
            type="number"
            className={inp}
            value={form.estimatedMinutes === 0 || form.estimatedMinutes === '' ? '' : form.estimatedMinutes}
            min={0}
            placeholder={t('task_estMinutesNone')}
            onChange={e => set('estimatedMinutes', e.target.value === '' ? '' : Number(e.target.value))}
            onBlur={e => {
              // Settle it on the way out: blank or nonsense becomes "no
              // estimate", which is 0 in the column and reads as N/A.
              const n = parseInt(e.target.value, 10)
              set('estimatedMinutes', Number.isFinite(n) && n > 0 ? n : 0)
            }}
          />
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
          {employees.map(emp => {
            // A task's project comes from its assignees, so someone with no
            // project cannot carry one. Saying so here beats failing on save.
            const noProject = !emp.projectId
            return (
              <button
                key={emp.id}
                type="button"
                disabled={noProject}
                title={noProject ? `${emp.name} is not on a project yet` : undefined}
                onClick={() => toggleEmployee(emp.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  noProject
                    ? 'bg-surface-2 text-text-subtle border-border cursor-not-allowed opacity-60'
                    : form.assignedTo.includes(emp.id)
                      ? 'bg-primary text-white border-primary'
                      : 'bg-surface text-text-muted border-border hover:border-primary/50'
                }`}
              >
                {emp.name}{noProject && ' · no project'}
              </button>
            )
          })}
        </div>
        {err('assignedTo')}
      </div>

      <div>
        <label className={lbl}>{t('task_frequency')}</label>
        <select className={inp} value={form.frequency.type}
          onChange={e => {
            const type = e.target.value as FrequencyType
            // A one-off needs a due date, so it opens on today rather than
            // blank — an empty box that only complains on save is a trap.
            // Any date already picked is kept when switching back to one-off.
            set('frequency',
              type === 'one-off'
                ? { type, date: form.frequency.date || format(new Date(), 'yyyy-MM-dd') }
                : { type })
          }}>
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
            <label className={lbl}>{t('task_onDate')}</label>
            {/* New tasks cannot be dated into the past, but an existing one
                whose date has already passed must still be editable —
                clamping it to today would silently reject its own value. */}
            <input type="date" className={inp} value={form.frequency.date ?? ''}
              onChange={e => setFreq('date', e.target.value)}
              min={initial ? undefined : format(new Date(), 'yyyy-MM-dd')} />
            <p className="text-text-subtle text-[11px] mt-1">{t('task_onDateHint')}</p>
            {err('date')}
          </div>
        )}
      </div>

      {/* The deadline is separate from the recurrence: when it must be
          finished by, regardless of which days it appears on. Optional — left
          empty, the employee decides, and it simply has no deadline. */}
      <div>
        <label className={lbl}>{t('task_deadline')}</label>
        <input
          type="date"
          className={inp}
          value={form.deadline ?? ''}
          onChange={e => set('deadline', e.target.value || null)}
        />
        <p className="text-text-subtle text-[11px] mt-1">{t('task_deadlineHint')}</p>
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

/**
 * Who is doing this task right now, and who has finished it.
 *
 * The table listed what a task *is* but never whether anything was happening
 * with it, so a manager had to open each one to find out. Status is per person
 * and per day: the same task is done by one assignee and untouched by another.
 *
 * This used to show the assignee's initials tinted by status, which read as a
 * status code but was not one — a one-word name gave a bare "E" and told you
 * nothing. It now names the state, and the person, in words.
 */
function TaskStatusCells({ task }: { task: Task }) {
  const { isTaskCompleted, isInProgress } = useTaskStore()
  const { t } = useT()
  const today = format(new Date(), 'yyyy-MM-dd')

  if (task.assignedTo.length === 0) {
    return <span className="text-[11px] text-text-subtle">-</span>
  }

  const states = task.assignedTo.map((empId) => {
    const done = isTaskCompleted(task.id, empId, today)
    return { done, running: !done && isInProgress(task.id, empId, today) }
  })

  // One status for the task, however many people are on it. Completed only
  // when everyone has finished, since one person finishing does not finish the
  // task; in progress the moment anyone has started.
  const done = states.every((s) => s.done)
  const running = !done && states.some((s) => s.running || s.done)

  const label = done
    ? t('status_completed')
    : running
      ? t('status_inProgress')
      : t('status_notStarted')

  const style = done
    ? 'bg-success-bg text-success border-success/30'
    : running
      ? 'bg-warning-bg text-warning border-warning/30'
      : 'bg-surface-2 text-text-subtle border-border'

  // How far along, when the task is shared and only some have finished. The
  // Assigned column already says who they are.
  const finished = states.filter((s) => s.done).length
  const partial = states.length > 1 && finished > 0 && !done

  return (
    <span
      className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${style}`}
    >
      {label}
      {partial && ` ${finished}/${states.length}`}
    </span>
  )
}

export function TaskManager({ preselectedEmployee }: { preselectedEmployee?: string }) {
  const { tasks, categories, addTask, updateTask, deleteTask, addCategory, scopedProjectId } = useTaskStore()
  const { employees } = useEmployeeStore()
  const { currentUser } = useAuthStore()
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

  const handleSave = async (data: any) => {
    // A save that fails must not close the form: losing what was typed and
    // showing nothing is how a broken save reads as a silent one.
    try {
      if (editing === 'new') {
        if (!currentUser) return
        // An employee belongs to exactly one project, so the assignees fix the task's project.
        const assignee = employees.find(e => e.id === data.assignedTo[0])
        const projectId = assignee?.projectId
        if (!projectId) {
          // Naming the person makes this actionable: the fix is to put them on
          // a project, and without the name there is no way to know who.
          alert(
            assignee
              ? `${assignee.name} is not assigned to a project yet, so this task has nowhere to live. Add them to a project first.`
              : t('task_errorNoProject')
          )
          return
        }
        // Only the first assignee's project is used, so anyone from another
        // project would be attached to a task their project never shows.
        const strays = data.assignedTo
          .map((id: string) => employees.find(e => e.id === id))
          .filter((e: any) => e && e.projectId !== projectId)
        if (strays.length > 0) {
          alert(
            `${strays.map((e: any) => e.name).join(', ')} ${strays.length === 1 ? 'is' : 'are'} on a different project, and a task can only belong to one. Create a separate task for them.`
          )
          return
        }

        await addTask({ ...data, projectId, createdBy: currentUser.id })

        // The list on screen is filtered to the project being viewed. A task
        // for someone on a different project saves fine and then vanishes,
        // which reads exactly like a failed save — so say where it went.
        if (scopedProjectId && projectId !== scopedProjectId) {
          alert(
            `Task saved. It belongs to ${assignee.name}'s project, not the one you are viewing, so it will not appear in this list.`
          )
        }
      } else if (editing) {
        await updateTask(editing.id, data)
      }
      setEditing(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'The task could not be saved.')
    }
  }

  const handleDelete = async (id: string) => {
    await deleteTask(id)
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
                      <Th label={t('task_colStatus')} />
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
                          <td className="py-2.5 px-3 text-text-muted text-xs">
                            {task.estimatedMinutes > 0 ? `${task.estimatedMinutes}m` : t('task_estMinutesNone')}
                          </td>
                          <td className="py-2.5 px-3">
                            <TaskStatusCells task={task} />
                          </td>
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
            defaultAssignee={preselectedEmployee}
            onAddCategory={addCategory}
          />
        </div>
      )}
    </div>
  )
}
