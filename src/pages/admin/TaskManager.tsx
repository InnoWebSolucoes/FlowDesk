import React, { useEffect, useState, useMemo } from 'react'
import { Plus, Search, Pencil, Trash2, X, Check, ListTodo } from 'lucide-react'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { Task, TaskFrequency, Category, FrequencyType } from '../../types'
import { Badge } from '../../components/shared/Badge'
import { EmptyState } from '../../components/shared/EmptyState'
import { format } from 'date-fns'
import { useT } from '../../i18n/useT'
import { useHighlight } from '../../hooks/useHighlight'
import { HIGHLIGHT_CLASS } from '../../lib/highlight'
import { useCreateTask } from '../../hooks/useCreateTask'
import { UrgentBadge, UrgentToggle } from '../../components/shared/Urgent'
import { Select } from '../../components/shared/Select'
import { DeleteTaskDialog } from '../../components/shared/DeleteTaskDialog'

const FREQ_OPTIONS: FrequencyType[] = ['daily', 'weekly', 'bi-weekly', 'monthly', 'one-off']

// One-off, on the day given or today: most work set up by hand happens once.
const defaultFreq = (date?: string): TaskFrequency => ({ type: 'one-off', date: date || format(new Date(), 'yyyy-MM-dd') })
// projectId is derived from the assignees at save time, so it isn't part of the form.
const defaultTask = (date?: string): Omit<Task, 'id' | 'createdAt' | 'createdBy' | 'projectId'> => ({
  title: '',
  description: '',
  assignedTo: [],
  frequency: defaultFreq(date),
  categoryId: '',
  isUrgent: false,
  estimatedMinutes: 30,
  isActive: true,
})

/**
 * The task editor. Exported so an employee's day, week and month sections can
 * open the same form the task manager uses — a manager editing a task from a
 * card should get the fields they already know, not a second cut-down editor
 * that drifts from this one.
 */
export function TaskForm({
  initial,
  onSave,
  onCancel,
  categories,
  employees,
  onAddCategory,
  defaultAssignee,
  defaultDate,
  onDelete,
}: {
  initial?: Task
  onSave: (data: any) => void
  onCancel: () => void
  categories: Category[]
  employees: import('../../types').Employee[]
  onAddCategory: (cat: Omit<Category, 'id'>) => Promise<Category>
  /** Whose profile this was opened from, so the task starts assigned to them. */
  defaultAssignee?: string
  /** The day it was started from, on the calendar, so a one-off lands there. */
  defaultDate?: string
  /**
   * Offered as a bin beside Cancel. Only where deleting is on the table —
   * the create form has nothing to delete yet.
   */
  onDelete?: () => void
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
          ...defaultTask(defaultDate),
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
    // An estimate is required: the day is planned from it.
    const mins = form.estimatedMinutes === '' ? 0 : Number(form.estimatedMinutes)
    if (!Number.isFinite(mins) || mins < 1) e.estimatedMinutes = t('task_errorMinutes')
    if ((form.frequency.type === 'weekly' || form.frequency.type === 'bi-weekly')
      && (!form.frequency.days || form.frequency.days.length === 0))
      e.days = t('task_errorDays')
    if (form.frequency.type === 'one-off' && !form.frequency.date) e.date = t('task_errorDate')
    // Without the week it counts from there is no telling one fortnight from
    // the next, so the rule would produce nothing at all.
    if (form.frequency.type === 'bi-weekly' && !form.frequency.date) e.date = t('task_errorBiWeeklyFrom')
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
    if (type === 'bi-weekly') return t('task_freqBiWeekly')
    if (type === 'monthly') return t('task_freqMonthly')
    if (type === 'one-off') return t('task_freqOneOff')
    return type
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
          <label className={lbl}>&nbsp;</label>
          <UrgentToggle urgent={!!form.isUrgent} onChange={(v) => set('isUrgent', v)} />
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
          <Select
            className="flex-1"
            value={form.categoryId}
            onChange={(v) => set('categoryId', v)}
            placeholder={t('task_selectCategory')}
            options={categories.map(c => ({ value: c.id, label: c.name, color: c.color }))}
          />
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
        <Select<FrequencyType>
          value={form.frequency.type}
          onChange={(type) => {
            // A one-off needs a due date, so it opens on today rather than
            // blank — an empty box that only complains on save is a trap.
            // Any date already picked is kept when switching back to one-off.
            // Both of these need a date to mean anything — a one-off its day,
            // a fortnightly task the week it counts from — so they open on
            // today rather than blank. An empty box that only complains on
            // save is a trap. Any date already picked is kept.
            set('frequency',
              type === 'one-off' || type === 'bi-weekly'
                ? {
                    type,
                    date: form.frequency.date || format(new Date(), 'yyyy-MM-dd'),
                    days: type === 'bi-weekly' ? form.frequency.days ?? [] : undefined,
                  }
                : { type })
          }}
          options={FREQ_OPTIONS.map(f => ({ value: f, label: freqLabel(f) }))}
        />

        {(form.frequency.type === 'weekly' || form.frequency.type === 'bi-weekly') && (
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

        {/* Which fortnight is the "on" one. Two weeks have no inherent
            beginning, so somebody has to say which — and the natural way to
            say it is to point at the first day it should happen. */}
        {form.frequency.type === 'bi-weekly' && (
          <div className="mt-2">
            <label className={lbl}>{t('task_biWeeklyFrom')}</label>
            <input type="date" className={inp} value={form.frequency.date ?? ''}
              onChange={e => setFreq('date', e.target.value)} />
            <p className="text-text-subtle text-[11px] mt-1">{t('task_biWeeklyFromHint')}</p>
            {err('date')}
          </div>
        )}

        {form.frequency.type === 'monthly' && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-text-muted mb-1">{t('task_weekOfMonth')}</p>
              <Select
                value={String(form.frequency.weekOfMonth ?? 1)}
                onChange={(v) => setFreq('weekOfMonth', parseInt(v))}
                options={[1,2,3,4].map(w => ({ value: String(w), label: `${t('task_week')} ${w}` }))}
              />
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">{t('task_dayOfWeek')}</p>
              <Select
                value={String(form.frequency.dayOfWeek ?? 1)}
                onChange={(v) => setFreq('dayOfWeek', parseInt(v))}
                options={[1,2,3,4,5,6,0].map(d => ({ value: String(d), label: DAY_NAMES[d] }))}
              />
            </div>
          </div>
        )}

        {/* The day it gets done — and the only date on this form. There was
            briefly a second "do date" box below the frequency, so a one-off
            asked for its day twice and the two could disagree. A recurring
            task has no date field at all: its days come from the rule above,
            which is the whole point of setting one. */}
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

      <div className="flex gap-2 pt-1">
        <button onClick={handleSave}
          className="flex-1 bg-primary text-white text-sm font-medium py-2.5 rounded-lg hover:bg-primary-dark transition-colors">
          {initial ? t('task_saveChanges') : t('task_createTask')}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2.5 border border-border text-text-muted text-sm rounded-lg hover:bg-surface-2 transition-colors">
          {t('task_cancel')}
        </button>
        {/* Beside Cancel, where you already are, rather than at the bottom of
            a panel below the form. */}
        {onDelete && (
          <button onClick={onDelete} title={t('taskcard_delete')}
            className="px-3 py-2.5 border border-border text-text-subtle rounded-lg hover:border-danger/50 hover:text-danger hover:bg-danger-bg transition-colors">
            <Trash2 size={15} />
          </button>
        )}
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
  const { tasks, categories, updateTask, addCategory } = useTaskStore()
  const { employees } = useEmployeeStore()
  // Work is assigned to staff, not to managers.
  const staff = employees.filter((e) => e.role === 'employee')
  const { t } = useT()

  const DAY_NAMES = [t('task_sun'), t('task_mon'), t('task_tue'), t('task_wed'), t('task_thu'), t('task_fri'), t('task_sat')]

  const [search, setSearch] = useState('')
  const [filterEmp, setFilterEmp] = useState(preselectedEmployee ?? '')
  const [filterCat, setFilterCat] = useState('')
  const [filterFreq, setFilterFreq] = useState('')
  const [sortCol, setSortCol] = useState<string>('title')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Task | null | 'new'>(null)
  // The task whose deletion is being confirmed. A repeating task has more
  // than one possible meaning for "delete", so it is asked rather than assumed.
  const [deleting, setDeleting] = useState<Task | null>(null)

  const PAGE_SIZE = 20

  const filtered = useMemo(() => {
    return tasks
      .filter(task => {
        if (search && !task.title.toLowerCase().includes(search.toLowerCase())) return false
        if (filterEmp && !task.assignedTo.includes(filterEmp)) return false
        if (filterCat && task.categoryId !== filterCat) return false
        if (filterFreq && task.frequency.type !== filterFreq) return false
        return true
      })
      .sort((a, b) => {
        // Urgent always on top, whatever column the rest is sorted by.
        if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1
        let va: any = a[sortCol as keyof Task]
        let vb: any = b[sortCol as keyof Task]
        if (typeof va === 'string') va = va.toLowerCase()
        if (typeof vb === 'string') vb = vb.toLowerCase()
        if (va < vb) return sortDir === 'asc' ? -1 : 1
        if (va > vb) return sortDir === 'asc' ? 1 : -1
        return 0
      })
  }, [tasks, search, filterEmp, filterCat, filterFreq, sortCol, sortDir])

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const highlight = useHighlight()

  /**
   * A notification points at one task, but this table filters and paginates —
   * so the row it means is usually neither visible nor on the current page.
   * Arriving with a highlight therefore clears every filter and pages to
   * wherever the task actually sits.
   */
  useEffect(() => {
    const id = highlight.activeId
    if (!id) return
    setSearch('')
    setFilterEmp('')
    setFilterCat('')
    setFilterFreq('')
  }, [highlight.activeId])

  // Paging is a second step: the index is only meaningful once the filters
  // above have actually been cleared and `filtered` has been rebuilt.
  useEffect(() => {
    const id = highlight.activeId
    if (!id) return
    const index = filtered.findIndex((x) => x.id === id)
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE))
  }, [highlight.activeId, filtered, PAGE_SIZE])

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const createTask = useCreateTask()

  const handleSave = async (data: any) => {
    // A save that fails must not close the form: losing what was typed and
    // showing nothing is how a broken save reads as a silent one.
    try {
      if (editing === 'new') {
        if (!(await createTask(data))) return
      } else if (editing) {
        await updateTask(editing.id, data)
      }
      setEditing(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'The task could not be saved.')
    }
  }



  const freqLabel = (task: Task) => {
    const f = task.frequency
    if (f.type === 'daily') return t('task_freqDaily')
    if (f.type === 'weekly') return `${t('task_freqWeekly')} (${(f.days ?? []).map(d => DAY_NAMES[d]).join(', ')})`
    if (f.type === 'bi-weekly') return `${t('task_freqBiWeekly')} (${(f.days ?? []).map(d => DAY_NAMES[d]).join(', ')})`
    if (f.type === 'monthly') return `${t('task_freqMonthly')} (${t('task_week')} ${f.weekOfMonth}, ${DAY_NAMES[f.dayOfWeek ?? 1]})`
    if (f.type === 'one-off') return `${t('task_freqOneOff')} (${f.date ?? ''})`
    return f.type
  }

  const freqOptionLabel = (f: string) => {
    if (f === 'daily') return t('task_freqDaily')
    if (f === 'weekly') return t('task_freqWeekly')
    if (f === 'bi-weekly') return t('task_freqBiWeekly')
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
            <Select
              className="w-44"
              value={filterEmp}
              onChange={(v) => { setFilterEmp(v); setPage(0) }}
              options={[{ value: '', label: t('task_allEmployees') }, ...employees.map(e => ({ value: e.id, label: e.name }))]}
            />
            <Select
              className="w-44"
              value={filterCat}
              onChange={(v) => { setFilterCat(v); setPage(0) }}
              options={[{ value: '', label: t('task_allCategories') }, ...categories.map(c => ({ value: c.id, label: c.name, color: c.color }))]}
            />
            <Select
              className="w-40"
              value={filterFreq}
              onChange={(v) => { setFilterFreq(v); setPage(0) }}
              options={[{ value: '', label: t('task_allFrequencies') }, ...FREQ_OPTIONS.map(f => ({ value: f, label: freqOptionLabel(f) }))]}
            />
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
                        <tr
                          key={task.id}
                          ref={highlight.isHighlighted(task.id) ? highlight.ref : undefined}
                          className={`border-b border-border/50 transition-colors ${
                            task.isUrgent ? 'bg-danger-bg/60 hover:bg-danger-bg' : 'hover:bg-surface-2/40'
                          } ${highlight.isHighlighted(task.id) ? HIGHLIGHT_CLASS : ''}`}
                        >
                          <td className={`py-2.5 px-3 font-medium text-text-main max-w-xs ${task.isUrgent ? 'border-l-4 border-l-danger' : ''}`}>
                            <div className="flex items-center gap-2">
                              <span className="line-clamp-1">{task.title}</span>
                              <UrgentBadge urgent={task.isUrgent} />
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-text-muted text-xs">{assignedNames}</td>
                          <td className="py-2.5 px-3 text-text-muted text-xs whitespace-nowrap">{freqLabel(task)}</td>
                          <td className="py-2.5 px-3">
                            {cat && <Badge label={cat.name} color={cat.color} size="sm" />}
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
                              <button onClick={() => setDeleting(task)}
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
            employees={staff}
            defaultAssignee={preselectedEmployee}
            onAddCategory={addCategory}
          />
        </div>
      )}

      {/* A repeating task can go for one day or for good, and this is where
          that is asked. There is no day in view here, so the day on offer is
          today — the day the status column reports on. */}
      {deleting && (
        <DeleteTaskDialog task={deleting} onClose={() => setDeleting(null)} />
      )}
    </div>
  )
}
