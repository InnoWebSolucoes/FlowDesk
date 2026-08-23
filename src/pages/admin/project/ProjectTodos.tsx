import React, { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import {
  ListTodo, Plus, Trash2, X, Link2, ChevronUp, ChevronDown, Circle, CheckCircle2,
  FolderOpen, Calendar, Pencil, Check,
} from 'lucide-react'
import { isBefore, parseISO, startOfToday } from 'date-fns'
import { Project, ProjectTodo, Priority } from '../../../types'
import { useProjectStore } from '../../../store/projectStore'
import { EmptyState } from '../../../components/shared/EmptyState'
import { FileKindIcon } from '../../../components/resources/ResourceThumbnail'

interface Ctx { project: Project }

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

const PRIORITY_STYLES: Record<Priority, string> = {
  high: 'bg-danger-bg text-danger',
  medium: 'bg-warning-bg text-warning',
  low: 'bg-surface-2 text-text-muted',
}

type SortMode = 'manual' | 'priority' | 'dueDate'

export function ProjectTodos() {
  const { project } = useOutletContext<Ctx>()
  const navigate = useNavigate()
  const {
    todos, todoLists, todosLoadedFor, loadTodos,
    createTodo, updateTodo, toggleTodo, deleteTodo, reorderTodos, setTodoLinks,
    createTodoList, updateTodoList, deleteTodoList,
    clusters, items, resourcesLoadedFor, loadResources,
  } = useProjectStore()

  const [newTitle, setNewTitle] = useState('')
  const [showCompleted, setShowCompleted] = useState(true)
  const [sortMode, setSortMode] = useState<SortMode>('manual')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  // Remembered per project so a reload returns to the list you were on.
  const [activeListId, setActiveListId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(`flowdesk:todoList:${project.id}`)
    } catch {
      return null
    }
  })
  const [renamingListId, setRenamingListId] = useState<string | null>(null)
  const [listNameDraft, setListNameDraft] = useState('')

  useEffect(() => {
    if (todosLoadedFor !== project.id) loadTodos(project.id)
    // Resources are needed to render and pick todo links.
    if (resourcesLoadedFor !== project.id) loadResources(project.id)
  }, [project.id, todosLoadedFor, resourcesLoadedFor, loadTodos, loadResources])

  const lists = useMemo(
    () => todoLists.filter((l) => l.projectId === project.id).sort((a, b) => a.sortOrder - b.sortOrder),
    [todoLists, project.id]
  )

  // Fall back to the first list whenever the active one goes away.
  const selectList = (id: string) => {
    setActiveListId(id)
    try {
      localStorage.setItem(`flowdesk:todoList:${project.id}`, id)
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

  const handleAdd = async () => {
    if (!currentListId || pendingTitles.length === 0) return
    setNewTitle('')
    for (const title of pendingTitles) {
      await createTodo(project.id, { title, listId: currentListId })
    }
  }

  const handleAddList = async () => {
    const created = await createTodoList(project.id, `List ${lists.length + 1}`)
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
    const count = todos.filter((t) => t.listId === listId).length
    const detail = count > 0 ? ` and its ${count} todo(s)` : ''
    if (!confirm(`Delete the list "${name}"${detail}? This cannot be undone.`)) return
    await deleteTodoList(listId)
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
        className={`group bg-surface border border-border rounded-xl px-3 py-2.5 ${
          todo.isCompleted ? 'opacity-60' : ''
        }`}
      >
        {/* Single row: checkbox · title · metadata · actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => toggleTodo(todo.id)}
            className={`flex-shrink-0 transition-colors ${
              todo.isCompleted ? 'text-success' : 'text-text-subtle hover:text-primary'
            }`}
            title={todo.isCompleted ? 'Mark as not done' : 'Mark as done'}
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
                onDoubleClick={() => setEditingId(todo.id)}
                className={`text-sm text-text-main truncate ${todo.isCompleted ? 'line-through' : ''}`}
                title={todo.title}
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
                  onClick={() => navigate(`/admin/projects/${project.id}/resources`)}
                  className="flex items-center gap-1 text-[11px] text-text-main bg-surface-2 border border-border hover:border-primary px-1.5 py-1 rounded-md transition-colors max-w-[130px]"
                  title={`${info.label} — open in Resources`}
                >
                  {info.isCluster ? <FolderOpen size={11} /> : <FileKindIcon mime={info.mime} size={11} />}
                  <span className="truncate">{info.label}</span>
                </button>
              )
            })}

            <button
              onClick={() => setLinkingId(todo.id)}
              className="flex items-center gap-1 text-[11px] text-text-muted hover:text-primary px-1.5 py-1 rounded-md bg-surface-2 transition-colors"
              title="Link resources"
            >
              <Link2 size={11} />
              {todo.links.length === 0 && <span className="hidden sm:inline">Link</span>}
            </button>

            <label
              className={`flex items-center gap-1 text-[11px] px-1.5 py-1 rounded-md cursor-pointer ${
                overdue ? 'bg-danger-bg text-danger' : 'bg-surface-2 text-text-muted'
              }`}
              title={todo.dueDate ? `Due ${todo.dueDate}` : 'Set a due date'}
            >
              <Calendar size={11} />
              <input
                type="date"
                value={todo.dueDate ?? ''}
                onChange={(e) => updateTodo(todo.id, { dueDate: e.target.value || null })}
                className={`bg-transparent border-0 text-[11px] focus:outline-none cursor-pointer ${
                  todo.dueDate ? 'w-[92px]' : 'w-[16px]'
                }`}
              />
            </label>

            <select
              value={todo.priority}
              onChange={(e) => updateTodo(todo.id, { priority: e.target.value as Priority })}
              className={`text-[11px] font-medium px-1.5 py-1 rounded-md border-0 cursor-pointer ${PRIORITY_STYLES[todo.priority]}`}
              title="Priority"
            >
              <option value="high">High</option>
              <option value="medium">Med</option>
              <option value="low">Low</option>
            </select>

            {/* Row actions, revealed on hover */}
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
          </div>
        </div>
      </div>
    )
  }

  const linkingTodo = linkingId ? todos.find((t) => t.id === linkingId) ?? null : null

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
              className={`group flex items-center gap-1.5 px-3 py-2 border-b-2 -mb-px flex-shrink-0 transition-colors ${
                isActive ? 'border-primary' : 'border-transparent'
              }`}
            >
              <button
                onClick={() => {
                  // First click selects the list; clicking the one already open
                  // starts renaming it.
                  if (isActive) {
                    setRenamingListId(list.id)
                    setListNameDraft(list.name)
                  } else {
                    selectList(list.id)
                  }
                }}
                className={`text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'text-primary' : 'text-text-muted hover:text-text-main'
                }`}
                title={isActive ? 'Click to rename' : list.name}
              >
                {list.name}
              </button>
              <span className="text-[10px] text-text-subtle bg-surface-2 px-1.5 py-0.5 rounded">
                {openCountFor(list.id)}
              </span>
              <button
                onClick={() => { setRenamingListId(list.id); setListNameDraft(list.name) }}
                className="opacity-0 group-hover:opacity-100 text-text-subtle hover:text-text-main transition-opacity p-0.5"
                title="Rename list"
              >
                <Pencil size={11} />
              </button>
              {lists.length > 1 && (
                <button
                  onClick={() => handleDeleteList(list.id, list.name)}
                  className="opacity-0 group-hover:opacity-100 text-text-subtle hover:text-danger transition-opacity p-0.5"
                  title="Delete list"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )
        })}

        <button
          onClick={handleAddList}
          className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-text-muted hover:text-primary transition-colors flex-shrink-0"
          title="New list"
        >
          <Plus size={14} /> List
        </button>
      </div>

      {/* Add box: accepts several todos at once, separated by commas or lines */}
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
                ? 'Add todos — separate with commas, or Shift+Enter for a new line'
                : 'Create a list first'
            }
            disabled={!currentListId}
            className="flex-1 px-3 py-2.5 rounded-lg bg-surface border border-border text-sm text-text-main resize-none focus:outline-none focus:border-primary disabled:opacity-50"
          />
          <button
            onClick={handleAdd}
            disabled={pendingTitles.length === 0 || !currentListId}
            className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-primary-dark disabled:opacity-40 transition-colors flex-shrink-0"
          >
            <Plus size={15} />
            {pendingTitles.length > 1 ? `Add ${pendingTitles.length}` : 'Add'}
          </button>
        </div>

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

      {/* Controls */}
      {listTodos.length > 0 && (
        <div className="flex items-center justify-between gap-3 mb-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-text-subtle">Sort</span>
            {(['manual', 'priority', 'dueDate'] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className={`px-2 py-1 rounded-md font-medium transition-colors ${
                  sortMode === mode ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface-2'
                }`}
              >
                {mode === 'manual' ? 'Manual' : mode === 'priority' ? 'Priority' : 'Due date'}
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
          description="These todos are for you and the other managers — employees never see them."
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

      {/* Resource link picker */}
      {linkingTodo && (
        <ResourceLinkPicker
          todo={linkingTodo}
          onClose={() => setLinkingId(null)}
          onSave={async (links) => {
            await setTodoLinks(linkingTodo.id, links)
            setLinkingId(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Link picker ─────────────────────────────────────────────────────────────

function ResourceLinkPicker({
  todo,
  onClose,
  onSave,
}: {
  todo: ProjectTodo
  onClose: () => void
  onSave: (links: { itemId?: string; clusterId?: string }[]) => Promise<void>
}) {
  const { clusters, items } = useProjectStore()
  const [selected, setSelected] = useState<{ itemId?: string; clusterId?: string }[]>(
    todo.links.map((l) => (l.itemId ? { itemId: l.itemId } : { clusterId: l.clusterId! }))
  )
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  const projectClusters = clusters.filter((c) => c.projectId === todo.projectId)
  const projectItems = items.filter((i) => i.projectId === todo.projectId)

  const q = query.trim().toLowerCase()
  const matchedClusters = projectClusters.filter((c) => !q || c.title.toLowerCase().includes(q))
  const matchedItems = projectItems.filter((i) => !q || i.title.toLowerCase().includes(q))

  const isSelected = (key: { itemId?: string; clusterId?: string }) =>
    selected.some((s) => (key.itemId ? s.itemId === key.itemId : s.clusterId === key.clusterId))

  const toggle = (key: { itemId?: string; clusterId?: string }) =>
    setSelected((prev) =>
      isSelected(key)
        ? prev.filter((s) => (key.itemId ? s.itemId !== key.itemId : s.clusterId !== key.clusterId))
        : [...prev, key]
    )

  /** Breadcrumb path so duplicate titles in different clusters stay distinguishable. */
  const pathOf = (clusterId: string | null): string => {
    const parts: string[] = []
    let id = clusterId
    while (id) {
      const c = projectClusters.find((x) => x.id === id)
      if (!c) break
      parts.unshift(c.title)
      id = c.parentClusterId
    }
    return parts.length > 0 ? parts.join(' › ') : 'Top level'
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border w-full max-w-lg flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-text-main font-semibold text-base">Link resources</h3>
            <p className="text-text-subtle text-xs truncate">{todo.title}</p>
          </div>
          <button onClick={onClose} className="text-text-subtle hover:text-text-main p-1 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border flex-shrink-0">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents and clusters…"
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {matchedClusters.length === 0 && matchedItems.length === 0 && (
            <p className="text-text-subtle text-sm text-center py-8">
              Nothing in this project's resources yet.
            </p>
          )}

          {matchedClusters.map((c) => {
            const key = { clusterId: c.id }
            return (
              <button
                key={c.id}
                onClick={() => toggle(key)}
                className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${
                  isSelected(key) ? 'border-primary bg-primary-light' : 'border-transparent hover:bg-surface-2'
                }`}
              >
                <FolderOpen size={16} style={{ color: c.color }} className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-text-main text-sm truncate">{c.title}</p>
                  <p className="text-text-subtle text-[11px] truncate">Cluster · {pathOf(c.parentClusterId)}</p>
                </div>
                {isSelected(key) && <CheckCircle2 size={15} className="text-primary flex-shrink-0" />}
              </button>
            )
          })}

          {matchedItems.map((i) => {
            const key = { itemId: i.id }
            return (
              <button
                key={i.id}
                onClick={() => toggle(key)}
                className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${
                  isSelected(key) ? 'border-primary bg-primary-light' : 'border-transparent hover:bg-surface-2'
                }`}
              >
                <span className="text-text-muted flex-shrink-0"><FileKindIcon mime={i.mimeType} size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-text-main text-sm truncate">{i.title}</p>
                  <p className="text-text-subtle text-[11px] truncate">{pathOf(i.clusterId)}</p>
                </div>
                {isSelected(key) && <CheckCircle2 size={15} className="text-primary flex-shrink-0" />}
              </button>
            )
          })}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center gap-2 flex-shrink-0">
          <span className="text-text-subtle text-xs flex-1">{selected.length} selected</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={async () => { setSaving(true); await onSave(selected); setSaving(false) }}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save links'}
          </button>
        </div>
      </div>
    </div>
  )
}
