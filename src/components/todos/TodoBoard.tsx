import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useHighlight } from '../../hooks/useHighlight'
import { HIGHLIGHT_CLASS } from '../../lib/highlight'
import {
  ListTodo, Plus, Trash2, Link2, ChevronUp, ChevronDown, Circle, CheckCircle2,
  FolderOpen, CalendarClock, Pencil, Check, Copy, Clock,
  GripVertical,
} from 'lucide-react'
import { isBefore, parseISO, startOfToday } from 'date-fns'
import { Project, ProjectTodo } from '../../types'
import { UrgentToggle } from '../shared/Urgent'
import { urgentFirst, URGENT_CLASS } from '../../lib/urgent'
import { useTodoTick } from '../../hooks/useTodoTick'
import { useProjectStore } from '../../store/projectStore'
import { EmptyState } from '../shared/EmptyState'
import { FileKindIcon } from '../resources/ResourceThumbnail'
import { ResourceLinkPicker } from '../shared/ResourceLinkPicker'
import { CalendarItemPanel } from '../calendar/CalendarItemPanel'
import { useT } from '../../i18n/useT'

interface TodoBoardProps {
  project: Project
  /**
   * Whose board this is. Null is the project's shared manager board — every
   * admin sees the same tabs. A user id is that person's private board, which
   * is what an employee gets.
   */
  ownerId: string | null
  /**
   * Where this side of the app lives, e.g. "/admin/projects/:id" or
   * "/employee". Links out of a todo resolve against it, so the same board can
   * open Resources on either side.
   */
  basePath: string
  /**
   * Read-only renders the board without any way to change it — how an admin
   * looks in on an employee's lists without being able to edit their work.
   */
  readOnly?: boolean
  emptyDescription?: string
}

type SortMode = 'manual' | 'doDate'

/**
 * The tabbed to-do list. One component serves the managers' shared board and
 * each employee's private one — they are the same tool, and having two copies
 * would mean every fix landing twice.
 */
export function TodoBoard({
  project,
  ownerId,
  basePath,
  readOnly = false,
  emptyDescription,
}: TodoBoardProps) {
  const { t } = useT()
  const navigate = useNavigate()
  const {
    todos, todoLists, todosLoadedFor, loadTodos,
    createTodo, updateTodo, setTodoState, deleteTodo, reorderTodos, setTodoLinks, moveTodoToList,
    createTodoList, updateTodoList, deleteTodoList, duplicateTodoList,
    clusters, items, resourcesLoadedFor, loadResources,
  } = useProjectStore()

  // One click: waiting. Two: done. Shared with the calendar.
  const tickTodo = useTodoTick()
  // A todo being carried by its grip: over the rows to reorder within the
  // list, or onto another list's tab to move it there. Pointer-driven, the
  // way the calendar moves things: the browser's own drag-and-drop did not
  // start reliably from these rows, so the pointer is followed by hand.
  const [dragTodo, setDragTodo] = useState<{ id: string; title: string } | null>(null)
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null)
  const [dropListId, setDropListId] = useState<string | null>(null)
  // The order the rows would take if released now: the dragged one slotted
  // where the pointer is. Shown live, written on release.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)

  const tabAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-list-tab]') as HTMLElement | null
    return el?.dataset.listTab ?? null
  }
  const rowAt = (x: number, y: number): { id: string; upperHalf: boolean } | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-todo-row]') as HTMLElement | null
    if (!el) return null
    const box = el.getBoundingClientRect()
    return { id: el.dataset.todoRow!, upperHalf: y < box.top + box.height / 2 }
  }

  useEffect(() => {
    if (!dragTodo) return
    const onMove = (e: PointerEvent) => {
      setDragPoint({ x: e.clientX, y: e.clientY })
      const tab = tabAt(e.clientX, e.clientY)
      setDropListId(tab)
      if (tab) return
      const row = rowAt(e.clientX, e.clientY)
      if (!row || row.id === dragTodo.id) return
      setDragOrder((prev) => {
        const base = prev ?? reorderable.map((t) => t.id)
        if (!base.includes(row.id) || !base.includes(dragTodo.id)) return prev
        const without = base.filter((id) => id !== dragTodo.id)
        const at = without.indexOf(row.id) + (row.upperHalf ? 0 : 1)
        const next = [...without.slice(0, at), dragTodo.id, ...without.slice(at)]
        return next.every((id, i) => id === base[i]) ? prev : next
      })
    }
    const onUp = (e: PointerEvent) => {
      const target = tabAt(e.clientX, e.clientY)
      const id = dragTodo.id
      const order = dragOrderRef.current
      setDragTodo(null)
      setDragPoint(null)
      setDropListId(null)
      setDragOrder(null)
      if (target && target !== currentListId) {
        moveTodoToList(id, target)
      } else if (order) {
        reorderTodos(order)
      }
    }
    const previousSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      document.body.style.userSelect = previousSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragTodo])

  const [newTitle, setNewTitle] = useState('')
  // Details filled in before the todo exists. Kept together so one reset
  // clears the whole draft after adding.
  const emptyDraft = {
    notes: '',
    isUrgent: false,
    doDate: '',
    links: [] as { itemId?: string; clusterId?: string }[],
  }
  const [draftOpen, setDraftOpen] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [draftLinking, setDraftLinking] = useState(false)
  const [error, setError] = useState('')
  const [showCompleted, setShowCompleted] = useState(true)
  const [sortMode, setSortMode] = useState<SortMode>('manual')
  const dragOrderRef = useRef<string[] | null>(null)
  useEffect(() => { dragOrderRef.current = dragOrder }, [dragOrder])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  // ?todo=<id> opens that todo directly, so a link from the assistant lands on
  // the item itself rather than just the board it lives on. ?highlight=<id> is
  // the lighter version: it rings the row in place rather than opening it,
  // which is what a notification wants.
  const [searchParams, setSearchParams] = useSearchParams()
  const highlight = useHighlight()
  // Remembered per project so a reload returns to the list you were on.
  const [activeListId, setActiveListId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(`flowdesk:todoList:${project.id}:${ownerId ?? 'shared'}`)
    } catch {
      return null
    }
  })
  const [renamingListId, setRenamingListId] = useState<string | null>(null)
  const [listNameDraft, setListNameDraft] = useState('')
  // Right-click menu on a list tab, positioned in screen coordinates.
  const [listMenu, setListMenu] = useState<{ listId: string; x: number; y: number } | null>(null)

  // The store holds one board at a time, so a change of owner has to refetch
  // even though the project is unchanged — otherwise an admin stepping into an
  // employee's lists would keep seeing their own. Hence the key, not the id.
  const boardKey = `${project.id}:${ownerId ?? 'shared'}`

  // The managers' shared board works differently from an employee's list:
  // no date on it, and a todo can be waiting on somebody
  // else between open and done.
  const adminBoard = ownerId === null
  // Right-click on a checkbox: pick the state outright.
  const [statusMenu, setStatusMenu] = useState<{ todoId: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (todosLoadedFor !== boardKey) loadTodos(project.id, ownerId)
    // Resources are needed to render and pick todo links.
    if (resourcesLoadedFor !== project.id) loadResources(project.id)
  }, [project.id, ownerId, boardKey, todosLoadedFor, resourcesLoadedFor, loadTodos, loadResources])

  const lists = useMemo(
    () =>
      todoLists
        .filter((l) => l.projectId === project.id && (l.ownerId ?? null) === ownerId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [todoLists, project.id, ownerId]
  )

  // Fall back to the first list whenever the active one goes away.
  const selectList = (id: string) => {
    setActiveListId(id)
    try {
      localStorage.setItem(`flowdesk:todoList:${project.id}:${ownerId ?? 'shared'}`, id)
    } catch {
      // Private mode or blocked storage — the tab just won't be remembered.
    }
  }

  const currentListId = activeListId && lists.some((l) => l.id === activeListId)
    ? activeListId
    : lists[0]?.id ?? null

  const listTodos = useMemo(
    () => todos.filter((t) => t.projectId === project.id && t.listId === currentListId),
    [todos, project.id, currentListId]
  )

  // A todo just marked waiting stays put for a moment before it sinks, so
  // there is time to click it again and make it done instead of chasing it
  // down the list. `settleAt` is bumped when the grace period ends, which
  // re-runs the sort with the todo now counted as waiting.
  const SINK_GRACE_MS = 1500
  const [settleAt, setSettleAt] = useState(0)
  useEffect(() => {
    if (!adminBoard) return
    const now = Date.now()
    const fresh = listTodos
      .filter((t) => !t.isCompleted && t.waitingSince)
      .map((t) => new Date(t.waitingSince!).getTime() + SINK_GRACE_MS - now)
      .filter((ms) => ms > 0)
    if (fresh.length === 0) return
    const id = setTimeout(() => setSettleAt(Date.now()), Math.max(...fresh) + 20)
    return () => clearTimeout(id)
  }, [listTodos, adminBoard])

  // Urgent todos always lead, whatever the order below them.
  const openTodos = useMemo(() => urgentFirst((() => {
    const list = listTodos.filter((t) => !t.isCompleted)
    // Managers' board: waiting todos sink below everything still to do, the
    // one most recently marked waiting at the top of that group. What needs
    // doing stays at the top; what is with somebody else collects under it.
    if (adminBoard) {
      const cutoff = Date.now() - SINK_GRACE_MS
      const sunk = (t: ProjectTodo) => !!t.waitingSince && new Date(t.waitingSince).getTime() < cutoff
      const doing = list.filter((t) => !sunk(t)).sort((a, b) => a.sortOrder - b.sortOrder)
      const waiting = list
        .filter(sunk)
        .sort((a, b) => (b.waitingSince ?? '').localeCompare(a.waitingSince ?? ''))
      return [...doing, ...waiting]
    }
    if (!adminBoard && sortMode === 'doDate') {
      return [...list].sort((a, b) => {
        if (!a.doDate && !b.doDate) return a.sortOrder - b.sortOrder
        if (!a.doDate) return 1
        if (!b.doDate) return -1
        return a.doDate.localeCompare(b.doDate)
      })
    }

    return [...list].sort((a, b) => a.sortOrder - b.sortOrder)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })()), [listTodos, sortMode, adminBoard, settleAt])

  // What a drag can reorder: the open todos still to do, in manual order.
  // Waiting todos keep their own order (by when they started waiting).
  const reorderable = useMemo(
    () => openTodos.filter((t) => !adminBoard || !t.waitingSince),
    [openTodos, adminBoard],
  )
  // Rows in the order being dragged into, while a drag is under way.
  const shownOpen = useMemo(() => {
    if (!dragOrder) return openTodos
    const byId = new Map(openTodos.map((t) => [t.id, t]))
    const moved = dragOrder.map((id) => byId.get(id)!).filter(Boolean)
    const rest = openTodos.filter((t) => !dragOrder.includes(t.id))
    return [...moved, ...rest]
  }, [openTodos, dragOrder])

  const completedTodos = useMemo(
    () => listTodos.filter((t) => t.isCompleted).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [listTodos]
  )

  const openCountFor = (listId: string) =>
    todos.filter((t) => t.listId === listId && !t.isCompleted).length

  // Everything that writes is off in read-only, so an admin looking in on an
  // employee's board cannot change it — the RLS refuses those writes anyway,
  // and a control that silently fails is worse than no control.
  const canEdit = !readOnly

  /**
   * Split bulk input into individual todos. Newlines always separate; commas
   * do too, so a quick "a, b, c" works — but only when the text has no line
   * breaks, so a single pasted line containing a comma isn't torn in half.
   */
  const parseTitles = (raw: string): string[] => {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const parts = lines.length > 1 ? lines : (lines[0] ?? '').split(',')
    return parts
      .map((p) => p.trim().replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(Boolean)
  }

  const pendingTitles = parseTitles(newTitle)

  // Whether the draft holds anything, so the + button can show it is carrying
  // details even while collapsed.
  const hasDraft =
    draft.notes.trim() !== '' ||
    draft.isUrgent ||
    draft.doDate !== '' ||
    draft.links.length > 0

  const handleAdd = async () => {
    if (!currentListId || pendingTitles.length === 0) return
    const details = draftOpen ? draft : emptyDraft
    setNewTitle('')
    try {
    for (const title of pendingTitles) {
      const created = await createTodo(
        project.id,
        {
          title,
          listId: currentListId,
          notes: details.notes,
          isUrgent: details.isUrgent,
          doDate: details.doDate || null,
        },
        ownerId,
      )
      // Links are a separate table, so they can only be attached once the
      // todo has an id.
      if (created && details.links.length > 0) {
        await setTodoLinks(created.id, details.links)
      }
    }
    } catch (e) {
      // createTodo throws on a refused insert; without this the loop dies
      // mid-batch and the box just empties with nothing added.
      setError((e as Error).message || 'That could not be added.')
      return
    }
    setDraft(emptyDraft)
    setDraftOpen(false)
  }

  const handleAddList = async () => {
    try {
      const created = await createTodoList(project.id, `List ${lists.length + 1}`, ownerId)
      if (created) {
        selectList(created.id)
        setRenamingListId(created.id)
        setListNameDraft(created.name)
      }
    } catch (e) {
      setError((e as Error).message || 'That list could not be created.')
    }
  }

  const commitListRename = async () => {
    if (renamingListId) {
      const name = listNameDraft.trim()
      if (name) await updateTodoList(renamingListId, { name })
    }
    setRenamingListId(null)
  }

  const handleDeleteList = async (listId: string, name: string) => {
    await deleteTodoList(listId)
  }

  const handleDuplicateList = async (listId: string) => {
    const created = await duplicateTodoList(listId)
    if (created) selectList(created.id)
  }

  const linkLabel = (link: { itemId: string | null; clusterId: string | null }) => {
    if (link.itemId) {
      const item = items.find((i) => i.id === link.itemId)
      return item ? { label: item.title, mime: item.mimeType, isCluster: false } : null
    }
    const cluster = clusters.find((c) => c.id === link.clusterId)
    return cluster ? { label: cluster.title, mime: null, isCluster: true } : null
  }

  const TodoRow = ({ todo }: { todo: ProjectTodo }) => {
    // Overdue is now measured against the do date, the only date there is:
    // the day it was meant to happen has passed and it did not happen.
    const overdue = !adminBoard && !todo.isCompleted && todo.doDate && isBefore(parseISO(todo.doDate), startOfToday())
    const waiting = adminBoard && !todo.isCompleted && !!todo.waitingSince
    const isEditing = editingId === todo.id

    return (
      <div
        ref={highlight.isHighlighted(todo.id) ? highlight.ref : undefined}
        data-todo-row={todo.id}
        className={`group border rounded-xl px-3 py-2.5 transition-[opacity,transform] ${dragTodo?.id === todo.id ? 'opacity-40 ring-2 ring-primary/40' : ''} ${
          todo.isUrgent && !todo.isCompleted
            ? `${URGENT_CLASS} border-l-4 border-l-danger`
            : 'bg-surface border-border'
        } ${
          todo.isCompleted ? 'opacity-60' : ''
        } ${highlight.isHighlighted(todo.id) ? HIGHLIGHT_CLASS : ''}`}
      >
        {/* Checkbox · title · metadata · actions. The metadata wraps under the
            title when the row runs out of width, rather than crushing it. */}
        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          {/* Hold this and carry the row: up or down to reorder, or onto
              another list's tab to move it there. */}
          {canEdit && !todo.isCompleted && (
            <button
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                if (sortMode !== 'manual') setSortMode('manual')
                setDragTodo({ id: todo.id, title: todo.title })
                setDragPoint({ x: e.clientX, y: e.clientY })
              }}
              title={t('todo_dragHint')}
              className="flex-shrink-0 text-text-subtle hover:text-text-main cursor-grab active:cursor-grabbing -ml-1"
            >
              <GripVertical size={14} />
            </button>
          )}
          <button
            onClick={() => canEdit && tickTodo(todo.id)}
            onContextMenu={(e) => {
              if (!adminBoard || !canEdit) return
              e.preventDefault()
              e.stopPropagation()
              setStatusMenu({ todoId: todo.id, x: e.clientX, y: e.clientY })
            }}
            disabled={!canEdit}
            className={`flex-shrink-0 transition-colors ${
              todo.isCompleted
                ? 'text-success'
                : waiting
                  ? 'text-amber hover:text-success'
                  : 'text-text-subtle hover:text-primary'
            } ${canEdit ? '' : 'cursor-default'}`}
            title={
              todo.isCompleted
                ? t('todo_statusDone')
                : waiting
                  ? t('todo_statusWaiting')
                  : adminBoard && canEdit
                    ? t('todo_statusHint')
                    : t('todo_statusOpen')
            }
          >
            {todo.isCompleted ? <CheckCircle2 size={19} /> : waiting ? <Clock size={19} /> : <Circle size={19} />}
          </button>

          {/* The title takes the slack, which puts the metadata flush against
              the right edge of the card rather than leaving the end of every
              row empty. */}
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <input
                autoFocus
                defaultValue={todo.title}
                onBlur={(e) => { updateTodo(todo.id, { title: e.target.value.trim() || todo.title }); setEditingId(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditingId(null)
                }}
                className="w-full px-2 py-1 rounded-md bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary"
              />
            ) : (
              <p
                onClick={() => setDetailId(todo.id)}
                onDoubleClick={(e) => { if (!canEdit) return; e.stopPropagation(); setEditingId(todo.id) }}
                className={`text-sm text-text-main truncate cursor-pointer hover:text-primary transition-colors ${todo.isCompleted ? 'line-through' : ''}`}
                title={canEdit ? 'Click to open · double-click to rename' : 'Click to open'}
              >
                {todo.title}
              </p>
            )}
            {todo.notes && (
              <p className="text-text-muted text-xs truncate" title={todo.notes}>{todo.notes}</p>
            )}
          </div>

          {/* Metadata, and after it the row actions — which take no width at
              all until the row is hovered, so they do not hold a column open
              down the right of the list. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {waiting && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-amber bg-amber/10 px-1.5 py-1 rounded-md">
                <Clock size={11} />
                {t('todo_waitingShort')}
              </span>
            )}

            {/* Linked resources */}
            {todo.links.map((link) => {
              const info = linkLabel(link)
              if (!info) return null
              return (
                <button
                  key={link.id}
                  onClick={() => navigate(`${basePath}/resources`)}
                  className="flex items-center gap-1 text-[11px] text-text-main bg-surface-2 border border-border hover:border-primary px-1.5 py-1 rounded-md transition-colors max-w-[130px]"
                  title={`${info.label}, open in Resources`}
                >
                  {info.isCluster ? <FolderOpen size={11} /> : <FileKindIcon mime={info.mime} size={11} />}
                  <span className="truncate">{info.label}</span>
                </button>
              )
            })}

            {canEdit && (
              <button
                onClick={() => setLinkingId(todo.id)}
                className="flex items-center gap-1 text-[11px] text-text-muted hover:text-primary px-1.5 py-1 rounded-md bg-surface-2 transition-colors"
                title={t('todo_linkResources')}
              >
                <Link2 size={11} />
                {todo.links.length === 0 && <span className="hidden sm:inline">{t('ui_link')}</span>}
              </button>
            )}

            {!todo.isCompleted && (canEdit || todo.isUrgent) && (
              <UrgentToggle
                compact
                urgent={todo.isUrgent}
                disabled={!canEdit}
                onChange={(v) => updateTodo(todo.id, { isUrgent: v })}
              />
            )}

            {!adminBoard && (
              <>
            {/* The do date, and the only date. It is what the calendar shows
                and what "when it must be done" now means; the separate
                deadline that used to sit beside it is gone. A day that has
                been and gone with the todo still open goes red — that is what
                overdue means now. */}
            <label
              className={`flex items-center gap-1 text-[11px] px-1.5 py-1 rounded-md cursor-pointer ${
                overdue
                  ? 'bg-danger-bg text-danger'
                  : todo.doDate
                    ? 'bg-primary-light text-primary'
                    : 'bg-surface-2 text-text-muted'
              }`}
              title={todo.doDate ? `Doing it on ${todo.doDate}` : 'Set a do date, the day it gets done'}
            >
              <CalendarClock size={11} />
              <input
                type="date"
                value={todo.doDate ?? ''}
                onChange={(e) => updateTodo(todo.id, { doDate: e.target.value || null })}
                disabled={!canEdit}
                className={`bg-transparent border-0 text-[11px] focus:outline-none cursor-pointer ${
                  todo.doDate ? 'w-[92px]' : 'w-[16px]'
                }`}
              />
            </label>

              </>
            )}

            {/* Row actions, revealed on hover */}
            {canEdit && (
            <div className="flex items-center w-0 overflow-hidden opacity-0 group-hover:w-auto group-hover:opacity-100 focus-within:w-auto focus-within:opacity-100 transition-opacity">
              <button onClick={() => setEditingId(todo.id)} className="text-text-subtle hover:text-text-main p-0.5 rounded" title={t('ui_edit')}>
                <Pencil size={13} />
              </button>
              <button onClick={() => deleteTodo(todo.id)} className="text-text-subtle hover:text-danger p-0.5 rounded" title={t('ui_delete')}>
                <Trash2 size={13} />
              </button>
            </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const linkingTodo = linkingId ? todos.find((t) => t.id === linkingId) ?? null : null
  /**
   * A ringed todo is no use on a tab you are not looking at, so arriving with
   * a highlight switches to the list that actually holds it and opens the
   * completed section in case it is finished.
   */
  useEffect(() => {
    const id = highlight.activeId
    if (!id) return
    const target = todos.find((x) => x.id === id)
    if (!target) return
    if (target.listId) setActiveListId(target.listId)
    if (target.isCompleted) setShowCompleted(true)
  }, [highlight.activeId, todos])

  const detailTodo = detailId ? todos.find((t) => t.id === detailId) ?? undefined : undefined

  useEffect(() => {
    const wanted = searchParams.get('todo')
    if (!wanted) return
    if (todos.some((t) => t.id === wanted)) {
      setDetailId(wanted)
      // Consume it, or reopening the panel after closing would be impossible.
      searchParams.delete('todo')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams, todos])

  return (
    // The shell already caps the page at a readable width; capping again here
    // left the rows stopping short of it with empty page beside them.
    <div>
      {/* List tabs */}
      <div className="flex items-center gap-1 border-b border-border mb-4 flex-wrap">
        {lists.map((list) => {
          const isActive = list.id === currentListId
          const isRenaming = renamingListId === list.id

          if (isRenaming) {
            return (
              <div key={list.id} className="flex items-center gap-1 px-2 py-1.5 flex-shrink-0">
                <input
                  autoFocus
                  value={listNameDraft}
                  onChange={(e) => setListNameDraft(e.target.value)}
                  onBlur={commitListRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitListRename()
                    if (e.key === 'Escape') setRenamingListId(null)
                  }}
                  className="w-28 px-2 py-1 rounded-md bg-surface-2 border border-primary text-sm text-text-main focus:outline-none"
                />
                <button onClick={commitListRename} className="text-success p-0.5"><Check size={13} /></button>
              </div>
            )
          }

          const canDrop = !!dragTodo && list.id !== currentListId
          return (
            <div
              key={list.id}
              data-list-tab={list.id}
              onContextMenu={(e) => {
                if (!canEdit) return
                e.preventDefault()
                setListMenu({ listId: list.id, x: e.clientX, y: e.clientY })
              }}
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 -mb-px flex-shrink-0 rounded-t-lg transition-colors ${
                isActive ? 'border-primary' : 'border-transparent'
              } ${canDrop && dropListId === list.id ? 'bg-primary-light ring-2 ring-primary/40' : canDrop ? 'bg-surface-2/60' : ''}`}
            >
              <button
                onClick={() => selectList(list.id)}
                className={`text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'text-primary' : 'text-text-muted hover:text-text-main'
                }`}
                title={canEdit ? `${list.name}, right-click for more` : list.name}
              >
                {list.name}
              </button>
              <span className="text-[10px] text-text-subtle bg-surface-2 px-1.5 py-0.5 rounded">
                {openCountFor(list.id)}
              </span>
            </div>
          )
        })}

        {canEdit && (
          <button
            onClick={handleAddList}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-text-muted hover:text-primary transition-colors flex-shrink-0"
            title={t('todo_newList')}
          >
            <Plus size={14} />{t('todo_list')}</button>
        )}
      </div>

      {/* The carried todo follows the pointer, so it is clear what is being
          moved and which tab it is over. */}
      {dragTodo && dragPoint && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded-md text-xs font-medium shadow-lg bg-primary text-white max-w-[220px] truncate"
          style={{ left: dragPoint.x + 12, top: dragPoint.y + 12 }}
        >
          {dragTodo.title}
        </div>
      )}

      {/* Right-click menu on a list tab */}
      {listMenu && (() => {
        const target = lists.find((l) => l.id === listMenu.listId)
        if (!target) return null
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setListMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setListMenu(null) }}
            />
            <div
              className="fixed z-50 w-44 py-1 bg-surface border border-border rounded-lg shadow-xl"
              style={{ left: listMenu.x, top: listMenu.y }}
            >
              <button
                onClick={() => {
                  setRenamingListId(target.id)
                  setListNameDraft(target.name)
                  setListMenu(null)
                }}
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
              >
                <Pencil size={12} />{t('ui_edit')}</button>
              <button
                onClick={() => { handleDuplicateList(target.id); setListMenu(null) }}
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
              >
                <Copy size={12} />{t('ui_duplicate')}</button>
              {lists.length > 1 && (
                <>
                  <div className="h-px bg-border my-1" />
                  <button
                    onClick={() => { setListMenu(null); handleDeleteList(target.id, target.name) }}
                    className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-2 transition-colors"
                  >
                    <Trash2 size={12} />{t('ui_delete')}</button>
                </>
              )}
            </div>
          </>
        )
      })()}

      {/* Right-click on a checkbox, managers' board only: choose the state
          outright rather than clicking round the cycle to reach it. */}
      {statusMenu && (() => {
        const target = todos.find((x) => x.id === statusMenu.todoId)
        if (!target) return null
        const current = target.isCompleted ? 'done' : target.waitingSince ? 'waiting' : 'open'
        const options = [
          { state: 'open' as const, label: t('todo_statusOpen'), Icon: Circle, tone: 'text-text-muted' },
          { state: 'waiting' as const, label: t('todo_statusWaiting'), Icon: Clock, tone: 'text-amber' },
          { state: 'done' as const, label: t('todo_statusDone'), Icon: CheckCircle2, tone: 'text-success' },
        ]
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setStatusMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setStatusMenu(null) }}
            />
            <div
              className="fixed z-50 w-56 py-1 bg-surface border border-border rounded-lg shadow-xl"
              style={{
                left: Math.max(8, Math.min(statusMenu.x, window.innerWidth - 232)),
                top: Math.max(8, Math.min(statusMenu.y, window.innerHeight - 130)),
              }}
            >
              {options.map(({ state, label, Icon, tone }) => (
                <button
                  key={state}
                  onClick={() => { setTodoState(target.id, state); setStatusMenu(null) }}
                  className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-surface-2 transition-colors ${
                    current === state ? 'font-semibold text-text-main' : 'text-text-main'
                  }`}
                >
                  <Icon size={13} className={tone} />
                  <span className="flex-1">{label}</span>
                  {current === state && <Check size={12} className="text-primary" />}
                </button>
              ))}
            </div>
          </>
        )
      })()}

      {error && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-danger-bg border border-danger/30 text-danger text-xs">
          {error}
          <button onClick={() => setError('')} className="ml-auto hover:opacity-70">×</button>
        </div>
      )}

      {/* Add box: accepts several todos at once, separated by commas or lines */}
      {canEdit && (
      <div className="mb-4">
        <div className="flex gap-2 items-start">
          <textarea
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              // Enter submits; Shift+Enter adds a line for multi-item entry.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleAdd()
              }
            }}
            rows={newTitle.includes('\n') ? Math.min(8, newTitle.split('\n').length + 1) : 1}
            placeholder={
              currentListId
                ? 'Add todos, separate with commas, or Shift+Enter for a new line'
                : 'Create a list first'
            }
            disabled={!currentListId}
            className="flex-1 px-3 py-2.5 rounded-lg bg-surface border border-border text-sm text-text-main resize-none focus:outline-none focus:border-primary disabled:opacity-50"
          />
          <button
            onClick={() => setDraftOpen((v) => !v)}
            disabled={!currentListId}
            title={draftOpen ? 'Hide details' : 'Add details before saving'}
            className={`flex items-center justify-center w-10 py-2.5 rounded-lg border transition-colors flex-shrink-0 disabled:opacity-40 ${
              draftOpen || hasDraft
                ? 'bg-primary-light border-primary/30 text-primary'
                : 'bg-surface border-border text-text-muted hover:text-text-main hover:border-primary/40'
            }`}
          >
            {draftOpen ? <ChevronUp size={15} /> : <Plus size={15} />}
          </button>
          <button
            onClick={handleAdd}
            disabled={pendingTitles.length === 0 || !currentListId}
            className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-primary-dark disabled:opacity-40 transition-colors flex-shrink-0"
          >
            <Plus size={15} />
            {pendingTitles.length > 1 ? `Add ${pendingTitles.length}` : 'Add'}
          </button>
        </div>

        {/* Details, filled in before the todo is created. Applied to every
            title in the box, so a bulk add shares them. */}
        {draftOpen && (
          <div className="mt-2 p-3 rounded-lg bg-surface-2 border border-border space-y-3">
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              rows={2}
              placeholder={t('ui_description')}
              className="w-full px-2.5 py-2 rounded-md bg-surface border border-border text-xs text-text-main resize-none focus:outline-none focus:border-primary"
            />

            {!adminBoard && (
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-text-subtle">{t('todo_doDate')}</span>
                <input
                  type="date"
                  value={draft.doDate}
                  onChange={(e) => setDraft((d) => ({ ...d, doDate: e.target.value }))}
                  className="px-2 py-1.5 rounded-md bg-surface border border-border text-xs text-text-main focus:outline-none focus:border-primary"
                />
              </label>
            </div>

            )}

            <div className="flex items-center gap-2 flex-wrap">
              <UrgentToggle urgent={draft.isUrgent} onChange={(v) => setDraft((d) => ({ ...d, isUrgent: v }))} />
              <button
                onClick={() => setDraftLinking(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-surface border border-border text-xs text-text-muted hover:text-text-main hover:border-primary/40 transition-colors"
              >
                <Link2 size={12} />
                {draft.links.length > 0 ? `${draft.links.length} attached` : 'Attach resources'}
              </button>
              {hasDraft && (
                <button
                  onClick={() => setDraft(emptyDraft)}
                  className="text-[11px] text-text-muted hover:text-text-main transition-colors"
                >{t('ui_clear')}</button>
              )}
            </div>
          </div>
        )}

        {/* Preview, so a comma-split is visible before committing to it */}
        {pendingTitles.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {pendingTitles.map((title, i) => (
              <span
                key={i}
                className="text-[11px] text-text-muted bg-surface-2 border border-border px-2 py-0.5 rounded"
              >
                {title}
              </span>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Controls */}
      {listTodos.length > 0 && (
        <div className="flex items-center justify-between gap-3 mb-3 text-xs">
          {adminBoard ? <span /> : (
          <div className="flex items-center gap-1.5">
            <span className="text-text-subtle">{t('todo_sort')}</span>
            {(['manual', 'doDate'] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className={`px-2 py-1 rounded-md font-medium transition-colors ${
                  sortMode === mode ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface-2'
                }`}
              >
                {mode === 'manual' ? 'Manual' : 'Do date'}
              </button>
            ))}
          </div>
          )}
          <span className="text-text-subtle">
            {openTodos.length} open · {completedTodos.length} done
          </span>
        </div>
      )}

      {listTodos.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title={t('todo_nothingInThisListYet')}
          description={
            emptyDescription ??
            'These todos are for you and the other managers, employees never see them.'
          }
        />
      ) : (
        <div className="space-y-2">
          {shownOpen.map((todo) => <TodoRow key={todo.id} todo={todo} />)}

          {completedTodos.length > 0 && (
            <div className="pt-4">
              <button
                onClick={() => setShowCompleted(!showCompleted)}
                className="flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-main mb-2 transition-colors"
              >
                {showCompleted ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                Completed ({completedTodos.length})
              </button>
              {showCompleted && (
                <div className="space-y-2">
                  {completedTodos.map((todo) => <TodoRow key={todo.id} todo={todo} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Same picker, but writing into the draft since there is no todo yet. */}
      {draftLinking && (
        <ResourceLinkPicker
          projectId={project.id}
          subtitle={pendingTitles[0] ?? 'New todo'}
          initial={draft.links}
          onClose={() => setDraftLinking(false)}
          onSave={async (links) => {
            setDraft((d) => ({ ...d, links }))
            setDraftLinking(false)
          }}
        />
      )}

      {/* Resource link picker, clusters can be selected or opened into. */}
      {linkingTodo && (
        <ResourceLinkPicker
          projectId={project.id}
          subtitle={linkingTodo.title}
          initial={linkingTodo.links.map((l) => (l.itemId ? { itemId: l.itemId } : { clusterId: l.clusterId! }))}
          onClose={() => setLinkingId(null)}
          onSave={async (links) => {
            await setTodoLinks(linkingTodo.id, links)
            setLinkingId(null)
          }}
        />
      )}

      {/* Full detail view: description, both dates, times, links. */}
      {detailTodo && (
        <CalendarItemPanel
          todo={detailTodo}
          projectId={project.id}
          basePath={basePath}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  )
}
