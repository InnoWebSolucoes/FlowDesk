import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useHighlight } from '../../hooks/useHighlight'
import { HIGHLIGHT_CLASS } from '../../lib/highlight'
import {
  ListTodo, Plus, Trash2, Link2, ChevronUp, ChevronDown, Circle, CheckCircle2,
  FolderOpen, Calendar, CalendarClock, Pencil, Check, Copy,
} from 'lucide-react'
import { isBefore, parseISO, startOfToday } from 'date-fns'
import { Project, ProjectTodo, Priority } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { EmptyState } from '../shared/EmptyState'
import { FileKindIcon } from '../resources/ResourceThumbnail'
import { ResourceLinkPicker } from '../shared/ResourceLinkPicker'
import { CalendarItemPanel } from '../calendar/CalendarItemPanel'

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

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

const PRIORITY_STYLES: Record<Priority, string> = {
  high: 'bg-danger-bg text-danger',
  medium: 'bg-warning-bg text-warning',
  low: 'bg-surface-2 text-text-muted',
}

type SortMode = 'manual' | 'priority' | 'dueDate' | 'doDate'

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
  const navigate = useNavigate()
  const {
    todos, todoLists, todosLoadedFor, loadTodos,
    createTodo, updateTodo, toggleTodo, deleteTodo, reorderTodos, setTodoLinks,
    createTodoList, updateTodoList, deleteTodoList, duplicateTodoList,
    clusters, items, resourcesLoadedFor, loadResources,
  } = useProjectStore()

  const [newTitle, setNewTitle] = useState('')
  // Details filled in before the todo exists. Kept together so one reset
  // clears the whole draft after adding.
  const emptyDraft = {
    notes: '',
    priority: 'medium' as Priority,
    dueDate: '',
    doDate: '',
    links: [] as { itemId?: string; clusterId?: string }[],
  }
  const [draftOpen, setDraftOpen] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [draftLinking, setDraftLinking] = useState(false)
  const [showCompleted, setShowCompleted] = useState(true)
  const [sortMode, setSortMode] = useState<SortMode>('manual')
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

  const openTodos = useMemo(() => {
    const list = listTodos.filter((t) => !t.isCompleted)
    if (sortMode === 'priority') {
      return [...list].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.sortOrder - b.sortOrder)
    }
    if (sortMode === 'doDate') {
      return [...list].sort((a, b) => {
        if (!a.doDate && !b.doDate) return a.sortOrder - b.sortOrder
        if (!a.doDate) return 1
        if (!b.doDate) return -1
        return a.doDate.localeCompare(b.doDate)
      })
    }

    if (sortMode === 'dueDate') {
      return [...list].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return a.sortOrder - b.sortOrder
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return a.dueDate.localeCompare(b.dueDate)
      })
    }
    return [...list].sort((a, b) => a.sortOrder - b.sortOrder)
  }, [listTodos, sortMode])

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
    draft.priority !== 'medium' ||
    draft.dueDate !== '' ||
    draft.doDate !== '' ||
    draft.links.length > 0

  const handleAdd = async () => {
    if (!currentListId || pendingTitles.length === 0) return
    const details = draftOpen ? draft : emptyDraft
    setNewTitle('')
    for (const title of pendingTitles) {
      const created = await createTodo(
        project.id,
        {
          title,
          listId: currentListId,
          notes: details.notes,
          priority: details.priority,
          dueDate: details.dueDate || null,
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
    setDraft(emptyDraft)
    setDraftOpen(false)
  }

  const handleAddList = async () => {
    const created = await createTodoList(project.id, `List ${lists.length + 1}`, ownerId)
    if (created) {
      selectList(created.id)
      setRenamingListId(created.id)
      setListNameDraft(created.name)
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

  const move = (todo: ProjectTodo, direction: -1 | 1) => {
    const ids = openTodos.map((t) => t.id)
    const idx = ids.indexOf(todo.id)
    const next = idx + direction
    if (idx === -1 || next < 0 || next >= ids.length) return
    ;[ids[idx], ids[next]] = [ids[next], ids[idx]]
    reorderTodos(ids)
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
    const overdue = !todo.isCompleted && todo.dueDate && isBefore(parseISO(todo.dueDate), startOfToday())
    const isEditing = editingId === todo.id

    return (
      <div
        ref={highlight.isHighlighted(todo.id) ? highlight.ref : undefined}
        className={`group bg-surface border border-border rounded-xl px-3 py-2.5 ${
          todo.isCompleted ? 'opacity-60' : ''
        } ${highlight.isHighlighted(todo.id) ? HIGHLIGHT_CLASS : ''}`}
      >
        {/* Single row: checkbox · title · metadata · actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => canEdit && toggleTodo(todo.id)}
            disabled={!canEdit}
            className={`flex-shrink-0 transition-colors ${
              todo.isCompleted ? 'text-success' : 'text-text-subtle hover:text-primary'
            } ${canEdit ? '' : 'cursor-default'}`}
            title={todo.isCompleted ? 'Done' : 'Not done yet'}
          >
            {todo.isCompleted ? <CheckCircle2 size={19} /> : <Circle size={19} />}
          </button>

          {/* Title takes the slack so the metadata stays right-aligned */}
          <div className="flex-1 min-w-0">
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

          {/* Metadata, inline to the right of the item */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
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
                title="Link resources"
              >
                <Link2 size={11} />
                {todo.links.length === 0 && <span className="hidden sm:inline">Link</span>}
              </button>
            )}

            {/* Do date: the day you plan to work on it. This is what the
                calendar shows, the deadline below is just the limit. */}
            <label
              className={`flex items-center gap-1 text-[11px] px-1.5 py-1 rounded-md cursor-pointer ${
                todo.doDate ? 'bg-primary-light text-primary' : 'bg-surface-2 text-text-muted'
              }`}
              title={todo.doDate ? `Doing it on ${todo.doDate}` : 'Set a do date, when you will actually do it'}
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

            <label
              className={`flex items-center gap-1 text-[11px] px-1.5 py-1 rounded-md cursor-pointer ${
                overdue ? 'bg-danger-bg text-danger' : 'bg-surface-2 text-text-muted'
              }`}
              title={todo.dueDate ? `Deadline ${todo.dueDate}` : 'Set a deadline'}
            >
              <Calendar size={11} />
              <input
                type="date"
                value={todo.dueDate ?? ''}
                onChange={(e) => updateTodo(todo.id, { dueDate: e.target.value || null })}
                disabled={!canEdit}
                className={`bg-transparent border-0 text-[11px] focus:outline-none cursor-pointer ${
                  todo.dueDate ? 'w-[92px]' : 'w-[16px]'
                }`}
              />
            </label>

            <select
              value={todo.priority}
              onChange={(e) => updateTodo(todo.id, { priority: e.target.value as Priority })}
              disabled={!canEdit}
              className={`text-[11px] font-medium px-1.5 py-1 rounded-md border-0 cursor-pointer ${PRIORITY_STYLES[todo.priority]}`}
              title="Priority"
            >
              <option value="high">High</option>
              <option value="medium">Med</option>
              <option value="low">Low</option>
            </select>

            {/* Row actions, revealed on hover */}
            {canEdit && (
            <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              {!todo.isCompleted && sortMode === 'manual' && (
                <>
                  <button onClick={() => move(todo, -1)} className="text-text-subtle hover:text-text-main p-0.5 rounded" title="Move up">
                    <ChevronUp size={14} />
                  </button>
                  <button onClick={() => move(todo, 1)} className="text-text-subtle hover:text-text-main p-0.5 rounded" title="Move down">
                    <ChevronDown size={14} />
                  </button>
                </>
              )}
              <button onClick={() => setEditingId(todo.id)} className="text-text-subtle hover:text-text-main p-0.5 rounded" title="Edit">
                <Pencil size={13} />
              </button>
              <button onClick={() => deleteTodo(todo.id)} className="text-text-subtle hover:text-danger p-0.5 rounded" title="Delete">
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
    <div className="max-w-5xl">
      {/* List tabs */}
      <div className="flex items-center gap-1 border-b border-border mb-4 overflow-x-auto">
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

          return (
            <div
              key={list.id}
              onContextMenu={(e) => {
                if (!canEdit) return
                e.preventDefault()
                setListMenu({ listId: list.id, x: e.clientX, y: e.clientY })
              }}
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 -mb-px flex-shrink-0 transition-colors ${
                isActive ? 'border-primary' : 'border-transparent'
              }`}
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
            title="New list"
          >
            <Plus size={14} /> List
          </button>
        )}
      </div>

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
                <Pencil size={12} /> Edit
              </button>
              <button
                onClick={() => { handleDuplicateList(target.id); setListMenu(null) }}
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
              >
                <Copy size={12} /> Duplicate
              </button>
              {lists.length > 1 && (
                <>
                  <div className="h-px bg-border my-1" />
                  <button
                    onClick={() => { setListMenu(null); handleDeleteList(target.id, target.name) }}
                    className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-2 transition-colors"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </>
              )}
            </div>
          </>
        )
      })()}

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
              placeholder="Description"
              className="w-full px-2.5 py-2 rounded-md bg-surface border border-border text-xs text-text-main resize-none focus:outline-none focus:border-primary"
            />

            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-text-subtle">Priority</span>
                <select
                  value={draft.priority}
                  onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as Priority }))}
                  className="px-2 py-1.5 rounded-md bg-surface border border-border text-xs text-text-main focus:outline-none focus:border-primary"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-text-subtle">Do date</span>
                <input
                  type="date"
                  value={draft.doDate}
                  onChange={(e) => setDraft((d) => ({ ...d, doDate: e.target.value }))}
                  className="px-2 py-1.5 rounded-md bg-surface border border-border text-xs text-text-main focus:outline-none focus:border-primary"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-text-subtle">Due date</span>
                <input
                  type="date"
                  value={draft.dueDate}
                  onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
                  className="px-2 py-1.5 rounded-md bg-surface border border-border text-xs text-text-main focus:outline-none focus:border-primary"
                />
              </label>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
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
                >
                  Clear
                </button>
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
          <div className="flex items-center gap-1.5">
            <span className="text-text-subtle">Sort</span>
            {(['manual', 'priority', 'doDate', 'dueDate'] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className={`px-2 py-1 rounded-md font-medium transition-colors ${
                  sortMode === mode ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface-2'
                }`}
              >
                {mode === 'manual' ? 'Manual' : mode === 'priority' ? 'Priority' : mode === 'doDate' ? 'Do date' : 'Deadline'}
              </button>
            ))}
          </div>
          <span className="text-text-subtle">
            {openTodos.length} open · {completedTodos.length} done
          </span>
        </div>
      )}

      {listTodos.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="Nothing in this list yet"
          description={
            emptyDescription ??
            'These todos are for you and the other managers, employees never see them.'
          }
        />
      ) : (
        <div className="space-y-2">
          {openTodos.map((todo) => <TodoRow key={todo.id} todo={todo} />)}

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
