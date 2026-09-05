import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import {
  Project, ResourceCluster, ResourceItem, ResourceItemLink, ResourceItemVersion,
  ProjectTodo, ProjectTodoLink, ProjectTodoList, CalendarEntry, ResourceAccess,
  ProjectNote, ProjectNoteItem,
} from '../types'

const BUCKET = 'attachments'

/**
 * Live subscription. Outside the store because it is a connection rather than
 * state, and must survive re-renders.
 */
let channel: ReturnType<typeof supabase.channel> | null = null

interface ProjectState {
  projects: Project[]
  clusters: ResourceCluster[]
  items: ResourceItem[]
  todos: ProjectTodo[]
  loading: boolean
  /** False until the first projects fetch settles, so routes don't bail early. */
  initialized: boolean
  resourcesLoadedFor: string | null
  todosLoadedFor: string | null

  initialize: () => Promise<void>
  /** Stop listening for live project changes. */
  teardown: () => void

  createProject: (input: Partial<Project> & { name: string }) => Promise<Project | null>
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  getProject: (id: string) => Project | undefined

  // Resources
  loadResources: (projectId: string) => Promise<void>
  createCluster: (projectId: string, parentClusterId: string | null, input: Partial<ResourceCluster>) => Promise<ResourceCluster | null>
  updateCluster: (id: string, updates: Partial<ResourceCluster>) => Promise<void>
  deleteCluster: (id: string) => Promise<void>
  /** Copy a cluster, its nested clusters, and the documents tagged into them. */
  duplicateCluster: (id: string) => Promise<ResourceCluster | null>

  createItem: (projectId: string, clusterId: string | null, input: Partial<ResourceItem>, file?: File) => Promise<ResourceItem | null>
  updateItem: (id: string, updates: Partial<ResourceItem>) => Promise<void>
  replaceItemFile: (id: string, file: File) => Promise<void>
  removeItemFile: (id: string) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  moveItem: (id: string, clusterId: string | null, x: number, y: number, fromClusterId?: string | null) => Promise<void>

  setItemLinks: (itemId: string, links: { id?: string; label: string; url: string }[]) => Promise<void>
  getFileUrl: (storagePath: string) => Promise<string | null>

  // Versions: a stack of file iterations under one document.
  addItemVersion: (itemId: string, file: File, label?: string) => Promise<void>
  makeVersionCurrent: (itemId: string, versionId: string) => Promise<void>
  deleteItemVersion: (itemId: string, versionId: string) => Promise<void>

  // Tags: the clusters a document appears in, beyond its home.
  setItemClusters: (itemId: string, clusterIds: string[]) => Promise<void>
  /** Who can see a document, and the named people when access is 'specific'. */
  setItemAccess: (itemId: string, access: ResourceAccess, userIds: string[]) => Promise<void>
  /** Who can see a cluster. Everything nested inside inherits it. */
  setClusterAccess: (clusterId: string, access: ResourceAccess, userIds: string[]) => Promise<void>
  /** Fold one document into another as its newest version. */
  stackItemOnto: (sourceId: string, targetId: string, fromClusterId: string | null) => Promise<void>
  duplicateItem: (itemId: string) => Promise<ResourceItem | null>

  // Todo lists
  todoLists: ProjectTodoList[]
  /**
   * `ownerId` null creates on the shared manager board; a user id creates on
   * that person's private one. Every todo/note call takes the same argument,
   * so one store serves the admin workspace and the employee's.
   */
  createTodoList: (projectId: string, name: string, ownerId?: string | null) => Promise<ProjectTodoList | null>
  updateTodoList: (id: string, updates: Partial<ProjectTodoList>) => Promise<void>
  deleteTodoList: (id: string) => Promise<void>
  duplicateTodoList: (id: string) => Promise<ProjectTodoList | null>
  moveTodoToList: (todoId: string, listId: string) => Promise<void>

  // Notes: a Keep-style board of sticky notes, per owner.
  notes: ProjectNote[]
  notesLoadedFor: string | null
  /**
   * The note open in the editor, if any. Live updates skip it so an autosave
   * echoing back does not reset the note under the caret.
   */
  editingNoteId: string | null
  setEditingNote: (id: string | null) => void
  loadNotes: (projectId: string, ownerId?: string | null) => Promise<void>
  createNote: (projectId: string, input?: Partial<ProjectNote>, ownerId?: string | null) => Promise<ProjectNote | null>
  updateNote: (id: string, updates: Partial<ProjectNote>) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  reorderNotes: (orderedIds: string[]) => Promise<void>
  /** Replaces a note's checklist wholesale; [] turns it back into free text. */
  setNoteItems: (noteId: string, items: { text: string; isChecked: boolean }[]) => Promise<void>
  toggleNoteItem: (noteId: string, itemId: string) => Promise<void>

  // Todos
  loadTodos: (projectId: string, ownerId?: string | null) => Promise<void>
  createTodo: (projectId: string, input: Partial<ProjectTodo>, ownerId?: string | null) => Promise<ProjectTodo | null>
  updateTodo: (id: string, updates: Partial<ProjectTodo>) => Promise<void>
  toggleTodo: (id: string) => Promise<void>
  deleteTodo: (id: string) => Promise<void>
  reorderTodos: (orderedIds: string[]) => Promise<void>
  setTodoLinks: (todoId: string, links: { itemId?: string; clusterId?: string }[]) => Promise<void>
  /** People a todo is shared with individually, beyond its visibility rule. */
  setTodoShares: (todoId: string, userIds: string[]) => Promise<void>

  // Calendar: busy/working blocks alongside the todos' do dates.
  calendarEntries: CalendarEntry[]
  calendarLoadedFor: string | null
  loadCalendar: (projectId: string | null) => Promise<void>
  createCalendarEntry: (input: Partial<CalendarEntry> & { startsAt: string; endsAt: string }) => Promise<CalendarEntry | null>
  updateCalendarEntry: (id: string, updates: Partial<CalendarEntry>) => Promise<void>
  deleteCalendarEntry: (id: string) => Promise<void>
  setCalendarEntryLinks: (entryId: string, links: { itemId?: string; clusterId?: string }[]) => Promise<void>
}

function toProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    companyName: row.company_name ?? '',
    description: row.description ?? '',
    industry: row.industry ?? '',
    website: row.website ?? undefined,
    contactName: row.contact_name ?? undefined,
    contactEmail: row.contact_email ?? undefined,
    contactPhone: row.contact_phone ?? undefined,
    address: row.address ?? undefined,
    color: row.color ?? '#6366f1',
    isArchived: row.is_archived ?? false,
    createdAt: row.created_at,
  }
}

function projectPatch(updates: Partial<Project>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (updates.name !== undefined) patch.name = updates.name
  if (updates.companyName !== undefined) patch.company_name = updates.companyName
  if (updates.description !== undefined) patch.description = updates.description
  if (updates.industry !== undefined) patch.industry = updates.industry
  if (updates.website !== undefined) patch.website = updates.website || null
  if (updates.contactName !== undefined) patch.contact_name = updates.contactName || null
  if (updates.contactEmail !== undefined) patch.contact_email = updates.contactEmail || null
  if (updates.contactPhone !== undefined) patch.contact_phone = updates.contactPhone || null
  if (updates.address !== undefined) patch.address = updates.address || null
  if (updates.color !== undefined) patch.color = updates.color
  if (updates.isArchived !== undefined) patch.is_archived = updates.isArchived
  return patch
}

function toCluster(row: any): ResourceCluster {
  return {
    id: row.id,
    projectId: row.project_id,
    parentClusterId: row.parent_cluster_id,
    title: row.title,
    color: row.color,
    x: row.x,
    y: row.y,
    radius: row.radius,
    createdAt: row.created_at,
    access: row.access ?? 'everyone',
    accessUserIds: (row.resource_cluster_access ?? []).map((a: any) => a.user_id),
  }
}

function toItemLink(row: any): ResourceItemLink {
  return {
    id: row.id,
    itemId: row.item_id,
    label: row.label ?? '',
    url: row.url,
    sortOrder: row.sort_order ?? 0,
  }
}

function toItemVersion(row: any): ResourceItemVersion {
  return {
    id: row.id,
    itemId: row.item_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: row.size,
    label: row.label ?? '',
    createdAt: row.created_at,
  }
}

function toItem(row: any): ResourceItem {
  const clusterId: string | null = row.cluster_id
  const taggedIds: string[] = (row.resource_item_clusters ?? []).map((c: any) => c.cluster_id)
  // The home cluster must always be a tag — every render path (the cluster's
  // contents, its pull-out previews) reads clusterIds, not clusterId. If the
  // join row is ever missing (a partial write, a data repair gone wrong) the
  // item would otherwise be invisible inside its own home, with no way to
  // reach it from the canvas at all.
  const clusterIds = clusterId && !taggedIds.includes(clusterId) ? [clusterId, ...taggedIds] : taggedIds

  return {
    id: row.id,
    projectId: row.project_id,
    clusterId,
    title: row.title,
    description: row.description ?? '',
    createdBy: row.created_by ?? null,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: row.size,
    x: row.x,
    y: row.y,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    links: (row.resource_item_links ?? []).map(toItemLink).sort((a: ResourceItemLink, b: ResourceItemLink) => a.sortOrder - b.sortOrder),
    versions: (row.resource_item_versions ?? [])
      .map(toItemVersion)
      .sort((a: ResourceItemVersion, b: ResourceItemVersion) => b.createdAt.localeCompare(a.createdAt)),
    clusterIds,
    showAtTopLevel: row.show_at_top_level ?? false,
    access: row.access ?? 'everyone',
    accessUserIds: (row.resource_item_access ?? []).map((a: any) => a.user_id),
  }
}

function toTodoLink(row: any): ProjectTodoLink {
  return {
    id: row.id,
    todoId: row.todo_id,
    itemId: row.item_id,
    clusterId: row.cluster_id,
  }
}

function toTodoList(row: any): ProjectTodoList {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id ?? null,
    name: row.name,
    color: row.color ?? '#6366f1',
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
  }
}

function toNoteItem(row: any): ProjectNoteItem {
  return {
    id: row.id,
    noteId: row.note_id,
    text: row.text ?? '',
    isChecked: row.is_checked ?? false,
    sortOrder: row.sort_order ?? 0,
  }
}

function toNote(row: any): ProjectNote {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id ?? null,
    title: row.title ?? '',
    body: row.body ?? '',
    content: row.content ?? '',
    color: row.color ?? '#fef3c7',
    isPinned: row.is_pinned ?? false,
    isArchived: row.is_archived ?? false,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    items: (row.project_note_items ?? []).map(toNoteItem)
      .sort((a: ProjectNoteItem, b: ProjectNoteItem) => a.sortOrder - b.sortOrder),
  }
}

function toTodo(row: any): ProjectTodo {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id ?? null,
    listId: row.list_id ?? null,
    title: row.title,
    notes: row.notes ?? '',
    priority: row.priority,
    isCompleted: row.is_completed,
    completedAt: row.completed_at,
    dueDate: row.due_date,
    doDate: row.do_date ?? null,
    doStart: row.do_start ?? null,
    doEnd: row.do_end ?? null,
    assigneeId: row.assignee_id ?? null,
    visibility: row.visibility ?? null,
    sharedWith: (row.project_todo_shares ?? []).map((s: any) => s.user_id),
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    links: (row.project_todo_links ?? []).map(toTodoLink),
  }
}

function toCalendarEntry(row: any): CalendarEntry {
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    ownerId: row.owner_id,
    title: row.title,
    notes: row.notes ?? '',
    kind: row.kind,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day ?? false,
    visibility: row.visibility ?? null,
    sharedWith: (row.calendar_entry_shares ?? []).map((s: any) => s.user_id),
    links: (row.calendar_entry_links ?? []).map((l: any) => ({
      id: l.id,
      entryId: l.entry_id,
      itemId: l.item_id,
      clusterId: l.cluster_id,
    })),
    createdAt: row.created_at,
  }
}

/** Storage path for a resource file. Only the first two segments are policy-enforced. */
function resourcePath(projectId: string, itemId: string, fileName: string) {
  const safe = fileName.replace(/[^\w.-]+/g, '_')
  return `resources/${projectId}/${itemId}-${safe}`
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  projects: [],
  clusters: [],
  items: [],
  todos: [],
  todoLists: [],
  notes: [],
  loading: false,
  initialized: false,
  resourcesLoadedFor: null,
  todosLoadedFor: null,
  notesLoadedFor: null,
  editingNoteId: null,
  setEditingNote: (id) => set({ editingNoteId: id }),

  initialize: async () => {
    set({ loading: true })
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at')

    set({
      projects: error || !data ? [] : data.map(toProject),
      loading: false,
      initialized: true,
    })

    // Todos, notes and calendar entries are all written by other people's
    // clients — a manager adding a todo, a colleague booking time. Without a
    // live channel none of it appears until the page is reloaded, which is the
    // staleness the task store already had fixed.
    //
    // Each board reloads only what it is currently showing: the store holds
    // one owner's board at a time, and `*LoadedFor` records which.
    if (channel) return
    channel = supabase
      .channel('project-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_todos' }, () => {
        const key = get().todosLoadedFor
        if (key) {
          const [projectId, owner] = key.split(':')
          get().loadTodos(projectId, owner === 'shared' ? null : owner)
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_todo_lists' }, () => {
        const key = get().todosLoadedFor
        if (key) {
          const [projectId, owner] = key.split(':')
          get().loadTodos(projectId, owner === 'shared' ? null : owner)
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_notes' }, (payload) => {
        // Your own note autosaves as you type, and each save echoes back here.
        // Reloading on that would replace the note under the caret mid-word,
        // so skip an update to the note currently being edited.
        const editing = get().editingNoteId
        if (editing && (payload.new as any)?.id === editing) return

        const key = get().notesLoadedFor
        if (key) {
          const [projectId, owner] = key.split(':')
          get().loadNotes(projectId, owner === 'shared' ? null : owner)
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_entries' }, () => {
        const loaded = get().calendarLoadedFor
        if (loaded) get().loadCalendar(loaded)
      })
      .subscribe()
  },

  teardown: () => {
    if (!channel) return
    supabase.removeChannel(channel)
    channel = null
  },

  createProject: async (input) => {
    const { data, error } = await supabase
      .from('projects')
      .insert({ name: input.name, ...projectPatch(input) })
      .select()
      .single()

    if (error || !data) {
      console.error('[createProject] failed:', error)
      throw error ?? new Error('Insert returned no row')
    }
    const project = toProject(data)
    set((s) => ({ projects: [...s.projects, project] }))
    return project
  },

  updateProject: async (id, updates) => {
    const patch = projectPatch(updates)
    if (Object.keys(patch).length === 0) return
    await supabase.from('projects').update(patch).eq('id', id)
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...updates } : p)) }))
  },

  deleteProject: async (id) => {
    await supabase.from('projects').delete().eq('id', id)
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      clusters: s.clusters.filter((c) => c.projectId !== id),
      items: s.items.filter((i) => i.projectId !== id),
      todos: s.todos.filter((t) => t.projectId !== id),
      todoLists: s.todoLists.filter((l) => l.projectId !== id),
      notes: s.notes.filter((n) => n.projectId !== id),
    }))
  },

  getProject: (id) => get().projects.find((p) => p.id === id),

  // ─── Resources ────────────────────────────────────────────────────────────

  loadResources: async (projectId) => {
    // The access join only resolves once the resource-access migration has run;
    // fall back rather than leaving the canvas empty in the meantime.
    const fetchItems = async () => {
      const withAccess = await supabase
        .from('resource_items')
        .select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id), resource_item_access(user_id)')
        .eq('project_id', projectId)
      if (!withAccess.error) return withAccess

      console.warn('[loadResources] falling back without access:', withAccess.error.message)
      return supabase
        .from('resource_items')
        .select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id)')
        .eq('project_id', projectId)
    }

    const fetchClusters = async () => {
      const withAccess = await supabase
        .from('resource_clusters')
        .select('*, resource_cluster_access(user_id)')
        .eq('project_id', projectId)
      if (!withAccess.error) return withAccess

      console.warn('[loadResources] clusters without access:', withAccess.error.message)
      return supabase.from('resource_clusters').select('*').eq('project_id', projectId)
    }

    const [clustersRes, itemsRes] = await Promise.all([
      fetchClusters(),
      fetchItems(),
    ])

    if (itemsRes.error) console.error('[loadResources] failed:', itemsRes.error)

    set({
      clusters: (clustersRes.data ?? []).map(toCluster),
      items: (itemsRes.data ?? []).map(toItem),
      resourcesLoadedFor: projectId,
    })
  },

  createCluster: async (projectId, parentClusterId, input) => {
    const { data, error } = await supabase
      .from('resource_clusters')
      .insert({
        project_id: projectId,
        parent_cluster_id: parentClusterId,
        title: input.title ?? 'New cluster',
        color: input.color ?? '#6366f1',
        x: input.x ?? 0,
        y: input.y ?? 0,
        radius: input.radius ?? 160,
      })
      .select()
      .single()

    if (error || !data) return null
    const cluster = toCluster(data)
    set((s) => ({ clusters: [...s.clusters, cluster] }))
    return cluster
  },

  updateCluster: async (id, updates) => {
    const patch: Record<string, unknown> = {}
    if (updates.title !== undefined) patch.title = updates.title
    if (updates.color !== undefined) patch.color = updates.color
    if (updates.x !== undefined) patch.x = updates.x
    if (updates.y !== undefined) patch.y = updates.y
    if (updates.radius !== undefined) patch.radius = updates.radius
    if (updates.parentClusterId !== undefined) patch.parent_cluster_id = updates.parentClusterId
    if (Object.keys(patch).length === 0) return

    // Optimistic, for the same reason as moveItem: a dragged bubble must not
    // snap back to its old position while the write is in flight.
    set((s) => ({ clusters: s.clusters.map((c) => (c.id === id ? { ...c, ...updates } : c)) }))
    await supabase.from('resource_clusters').update(patch).eq('id', id)
  },

  deleteCluster: async (id) => {
    // Children cascade in the DB; mirror that in local state by walking the tree.
    const { clusters, items } = get()
    const doomed = new Set<string>([id])
    let grew = true
    while (grew) {
      grew = false
      for (const c of clusters) {
        if (c.parentClusterId && doomed.has(c.parentClusterId) && !doomed.has(c.id)) {
          doomed.add(c.id)
          grew = true
        }
      }
    }

    const doomedItems = items.filter((i) => i.clusterId && doomed.has(i.clusterId))
    const paths = doomedItems.map((i) => i.storagePath).filter((p): p is string => !!p)
    if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths)

    await supabase.from('resource_clusters').delete().eq('id', id)
    set((s) => ({
      clusters: s.clusters.filter((c) => !doomed.has(c.id)),
      items: s.items.filter((i) => !(i.clusterId && doomed.has(i.clusterId))),
    }))
  },

  duplicateCluster: async (id) => {
    const { clusters, items } = get()
    const source = clusters.find((c) => c.id === id)
    if (!source) return null

    /**
     * Copies one cluster and recurses into its children. Documents are tagged
     * into the copy rather than duplicated: one document, many places, which is
     * how tagging works everywhere else in the canvas.
     */
    const copyInto = async (
      original: ResourceCluster,
      parentId: string | null,
      offset: number,
    ): Promise<ResourceCluster | null> => {
      const created = await get().createCluster(original.projectId, parentId, {
        title: parentId === source.parentClusterId ? `${original.title} (copy)` : original.title,
        color: original.color,
        x: original.x + offset,
        y: original.y + offset,
        radius: original.radius,
      })
      if (!created) return null

      for (const item of items.filter((i) => i.clusterIds.includes(original.id))) {
        await get().setItemClusters(item.id, [...new Set([...item.clusterIds, created.id])])
      }

      for (const child of clusters.filter((c) => c.parentClusterId === original.id)) {
        await copyInto(child, created.id, 0)
      }
      return created
    }

    return copyInto(source, source.parentClusterId, 60)
  },

  createItem: async (projectId, clusterId, input, file) => {
    // Stamped rather than left to a default: it is what tells an employee's
    // own uploads apart from the project's files, and their insert policy
    // requires it to be them.
    const { data: auth } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('resource_items')
      .insert({
        project_id: projectId,
        cluster_id: clusterId,
        created_by: auth.user?.id ?? null,
        title: input.title ?? file?.name ?? 'Untitled',
        description: input.description ?? '',
        x: input.x ?? 0,
        y: input.y ?? 0,
        // Created outside any cluster means it lives in the main space.
        show_at_top_level: clusterId === null,
      })
      .select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id), resource_item_access(user_id)')
      .single()

    if (error || !data) return null
    let item = toItem(data)

    if (file) {
      const path = resourcePath(projectId, item.id, file.name)
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
      if (!upErr) {
        const filePatch = {
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          size: file.size,
        }
        await supabase.from('resource_items').update(filePatch).eq('id', item.id)
        item = {
          ...item,
          storagePath: path,
          fileName: file.name,
          mimeType: filePatch.mime_type,
          size: file.size,
        }
      }
    }

    // The home cluster is also the item's first tag, so the tag table alone
    // describes everywhere a document appears.
    if (clusterId) {
      await supabase.from('resource_item_clusters').insert({ item_id: item.id, cluster_id: clusterId })
      item = { ...item, clusterIds: [clusterId] }
    }

    set((s) => ({ items: [...s.items, item] }))
    return item
  },

  updateItem: async (id, updates) => {
    const patch: Record<string, unknown> = {}
    if (updates.title !== undefined) patch.title = updates.title
    if (updates.description !== undefined) patch.description = updates.description
    if (updates.x !== undefined) patch.x = updates.x
    if (updates.y !== undefined) patch.y = updates.y
    if (updates.clusterId !== undefined) patch.cluster_id = updates.clusterId
    if (updates.showAtTopLevel !== undefined) patch.show_at_top_level = updates.showAtTopLevel
    if (Object.keys(patch).length === 0) return

    patch.updated_at = new Date().toISOString()
    await supabase.from('resource_items').update(patch).eq('id', id)
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...updates } : i)) }))
  },

  /** Swap the file bytes, keeping title, description and links intact. */
  replaceItemFile: async (id, file) => {
    const item = get().items.find((i) => i.id === id)
    if (!item) return

    const path = resourcePath(item.projectId, item.id, file.name)
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
    if (error) return

    // Remove the superseded object only if the new upload landed elsewhere.
    if (item.storagePath && item.storagePath !== path) {
      await supabase.storage.from(BUCKET).remove([item.storagePath])
    }

    const patch = {
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size: file.size,
      updated_at: new Date().toISOString(),
    }
    await supabase.from('resource_items').update(patch).eq('id', id)
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id
          ? { ...i, storagePath: path, fileName: file.name, mimeType: patch.mime_type, size: file.size, updatedAt: patch.updated_at }
          : i
      ),
    }))
  },

  removeItemFile: async (id) => {
    const item = get().items.find((i) => i.id === id)
    if (!item?.storagePath) return

    await supabase.storage.from(BUCKET).remove([item.storagePath])
    await supabase
      .from('resource_items')
      .update({ storage_path: null, file_name: null, mime_type: null, size: null })
      .eq('id', id)

    set((s) => ({
      items: s.items.map((i) =>
        i.id === id ? { ...i, storagePath: null, fileName: null, mimeType: null, size: null } : i
      ),
    }))
  },

  deleteItem: async (id) => {
    const item = get().items.find((i) => i.id === id)
    if (item?.storagePath) await supabase.storage.from(BUCKET).remove([item.storagePath])
    await supabase.from('resource_items').delete().eq('id', id)
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
  },

  moveItem: async (id, clusterId, x, y, fromClusterId) => {
    const prev = get().items.find((i) => i.id === id)
    const oldHome = prev?.clusterId ?? null
    // The tag being dragged out of, when it isn't the item's home (e.g. its
    // preview shown inside a cluster it's only tagged into, not living in).
    const oldTag = fromClusterId !== undefined ? fromClusterId : oldHome
    // The home only follows the drag when we're actually dragging the item's
    // home card. Pulling a secondary-tag preview out of a bubble just swaps
    // that tag for wherever it landed — the home, and its x/y, don't move.
    const movingHome = oldTag === oldHome

    // Swaps the tag being dragged out of for the new one, leaving any other
    // tags alone: a document tagged into several clusters keeps appearing in
    // the rest of them — a move must not leave a copy behind at the spot it
    // was just dragged out of.
    const nextTags = (() => {
      const tags = new Set(prev?.clusterIds ?? [])
      if (oldTag) tags.delete(oldTag)
      if (clusterId) tags.add(clusterId)
      return [...tags]
    })()

    // Moving to or from the main space flips the top-level flag, so a move is
    // always a move rather than leaving a copy behind at the old level.
    // Only meaningful when the home itself is what's moving.
    const topLevel = movingHome ? clusterId === null : (prev?.showAtTopLevel ?? false)

    // Optimistic: apply locally first so the node stays where it was dropped
    // instead of flashing back to its old position during the round-trip.
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id
          ? movingHome
            ? { ...i, clusterId, x, y, clusterIds: nextTags, showAtTopLevel: topLevel }
            : { ...i, clusterIds: nextTags }
          : i
      ),
    }))

    if (movingHome) {
      await supabase
        .from('resource_items')
        .update({ cluster_id: clusterId, x, y, show_at_top_level: topLevel })
        .eq('id', id)
    }

    if (oldTag && oldTag !== clusterId) {
      await supabase.from('resource_item_clusters').delete().eq('item_id', id).eq('cluster_id', oldTag)
    }
    if (clusterId && clusterId !== oldTag) {
      await supabase
        .from('resource_item_clusters')
        .upsert({ item_id: id, cluster_id: clusterId }, { onConflict: 'item_id,cluster_id' })
    }
  },

  setItemLinks: async (itemId, links) => {
    await supabase.from('resource_item_links').delete().eq('item_id', itemId)

    const rows = links
      .filter((l) => l.url.trim().length > 0)
      .map((l, idx) => ({ item_id: itemId, label: l.label, url: l.url, sort_order: idx }))

    let saved: ResourceItemLink[] = []
    if (rows.length > 0) {
      const { data } = await supabase.from('resource_item_links').insert(rows).select()
      saved = (data ?? []).map(toItemLink).sort((a, b) => a.sortOrder - b.sortOrder)
    }

    set((s) => ({ items: s.items.map((i) => (i.id === itemId ? { ...i, links: saved } : i)) }))
  },

  getFileUrl: async (storagePath) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60)
    if (error || !data) return null
    return data.signedUrl
  },

  // ─── Versions ─────────────────────────────────────────────────────────────

  /**
   * Push a new file onto the document. The file that was current is archived as
   * a version first, so nothing is ever lost by uploading a newer copy.
   */
  addItemVersion: async (itemId, file, label = '') => {
    const item = get().items.find((i) => i.id === itemId)
    if (!item) return

    // Unique path per version, so archived files don't overwrite each other.
    const path = `resources/${item.projectId}/${itemId}-v${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file)
    if (error) return

    // Archive whatever is current before replacing it.
    if (item.storagePath) {
      await supabase.from('resource_item_versions').insert({
        item_id: itemId,
        storage_path: item.storagePath,
        file_name: item.fileName ?? 'file',
        mime_type: item.mimeType,
        size: item.size,
      })
    }

    const patch = {
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size: file.size,
      updated_at: new Date().toISOString(),
    }
    await supabase.from('resource_items').update(patch).eq('id', itemId)

    // Re-read so the version list reflects the archive insert above.
    const { data } = await supabase
      .from('resource_items')
      .select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id), resource_item_access(user_id)')
      .eq('id', itemId)
      .single()

    if (data) {
      const fresh = toItem(data)
      set((s) => ({ items: s.items.map((i) => (i.id === itemId ? fresh : i)) }))
    }
  },

  /** Swap an archived version with the current file — the current one is kept. */
  makeVersionCurrent: async (itemId, versionId) => {
    const item = get().items.find((i) => i.id === itemId)
    const version = item?.versions.find((v) => v.id === versionId)
    if (!item || !version) return

    // The outgoing current file takes the promoted version's row, so the
    // history keeps exactly one entry per file rather than growing on promote.
    if (item.storagePath) {
      await supabase
        .from('resource_item_versions')
        .update({
          storage_path: item.storagePath,
          file_name: item.fileName ?? 'file',
          mime_type: item.mimeType,
          size: item.size,
        })
        .eq('id', versionId)
    } else {
      await supabase.from('resource_item_versions').delete().eq('id', versionId)
    }

    await supabase
      .from('resource_items')
      .update({
        storage_path: version.storagePath,
        file_name: version.fileName,
        mime_type: version.mimeType,
        size: version.size,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId)

    const { data } = await supabase
      .from('resource_items')
      .select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id), resource_item_access(user_id)')
      .eq('id', itemId)
      .single()

    if (data) {
      const fresh = toItem(data)
      set((s) => ({ items: s.items.map((i) => (i.id === itemId ? fresh : i)) }))
    }
  },

  deleteItemVersion: async (itemId, versionId) => {
    const item = get().items.find((i) => i.id === itemId)
    const version = item?.versions.find((v) => v.id === versionId)
    if (!version) return

    await supabase.storage.from(BUCKET).remove([version.storagePath])
    await supabase.from('resource_item_versions').delete().eq('id', versionId)

    set((s) => ({
      items: s.items.map((i) =>
        i.id === itemId ? { ...i, versions: i.versions.filter((v) => v.id !== versionId) } : i
      ),
    }))
  },

  // ─── Cluster tags ─────────────────────────────────────────────────────────

  /** Set the full list of clusters this document appears in. */
  setItemClusters: async (itemId, clusterIds) => {
    await supabase.from('resource_item_clusters').delete().eq('item_id', itemId)
    if (clusterIds.length > 0) {
      await supabase
        .from('resource_item_clusters')
        .insert(clusterIds.map((cluster_id) => ({ item_id: itemId, cluster_id })))
    }
    set((s) => ({ items: s.items.map((i) => (i.id === itemId ? { ...i, clusterIds } : i)) }))
  },

  /**
   * Stack one document onto another: the source's file becomes the target's
   * current file, and the target's previous file drops into its history. The
   * source's own history comes along, so nothing is lost.
   *
   * `fromClusterId` is where the drag started: the source stops appearing
   * there, but stays in every other cluster it was tagged into. It is only
   * deleted outright once it has nowhere left to appear.
   */
  stackItemOnto: async (sourceId, targetId, fromClusterId) => {
    const { items } = get()
    const source = items.find((i) => i.id === sourceId)
    const target = items.find((i) => i.id === targetId)
    if (!source || !target || sourceId === targetId || !source.storagePath) return

    // The target's current file becomes history, then the source's file
    // becomes current — so the newest lands on top, as with a normal upload.
    const archive: Record<string, unknown>[] = []
    if (target.storagePath) {
      archive.push({
        item_id: targetId,
        storage_path: target.storagePath,
        file_name: target.fileName ?? 'file',
        mime_type: target.mimeType,
        size: target.size,
      })
    }
    // Carry the source's own archived versions over as well.
    for (const v of source.versions) {
      archive.push({
        item_id: targetId,
        storage_path: v.storagePath,
        file_name: v.fileName,
        mime_type: v.mimeType,
        size: v.size,
        label: v.label,
      })
    }
    if (archive.length > 0) {
      await supabase.from('resource_item_versions').insert(archive)
    }

    await supabase
      .from('resource_items')
      .update({
        storage_path: source.storagePath,
        file_name: source.fileName,
        mime_type: source.mimeType,
        size: source.size,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetId)

    // The source keeps its other homes; it only goes away when this was the
    // last place it appeared. Its version rows are detached first so the
    // cascade doesn't delete the files we just handed to the target.
    await supabase.from('resource_item_versions').delete().eq('item_id', sourceId)

    const remainingClusters = source.clusterIds.filter((id) => id !== fromClusterId)
    const stillTopLevel = source.showAtTopLevel && fromClusterId !== null

    if (remainingClusters.length === 0 && !stillTopLevel) {
      // Nowhere left to live: drop the row, but keep the file — the target
      // now points at it.
      await supabase.from('resource_items').delete().eq('id', sourceId)
    } else {
      if (fromClusterId !== null) {
        await supabase
          .from('resource_item_clusters')
          .delete()
          .eq('item_id', sourceId)
          .eq('cluster_id', fromClusterId)
      }
      const patch: Record<string, unknown> = {}
      if (fromClusterId === null) patch.show_at_top_level = false
      if (source.clusterId === fromClusterId) patch.cluster_id = remainingClusters[0] ?? null
      if (Object.keys(patch).length > 0) {
        await supabase.from('resource_items').update(patch).eq('id', sourceId)
      }
    }

    // Re-read both rows so versions and tags reflect everything above.
    const { data } = await supabase
      .from('resource_items')
      .select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id), resource_item_access(user_id)')
      .in('id', [sourceId, targetId])

    const fresh = (data ?? []).map(toItem)
    set((s) => ({
      items: s.items
        .map((i) => fresh.find((f) => f.id === i.id) ?? i)
        .filter((i) => i.id !== sourceId || fresh.some((f) => f.id === sourceId)),
    }))
  },

  setClusterAccess: async (clusterId, access, userIds) => {
    await supabase.from('resource_clusters').update({ access }).eq('id', clusterId)
    await supabase.from('resource_cluster_access').delete().eq('cluster_id', clusterId)

    // 'relative' names people too — they are who may enter the cluster. Only
    // the levels that name nobody clear the list.
    const named = access === 'specific' || access === 'relative' ? userIds : []
    if (named.length > 0) {
      await supabase
        .from('resource_cluster_access')
        .insert(named.map((user_id) => ({ cluster_id: clusterId, user_id })))
    }

    set((s) => ({
      clusters: s.clusters.map((c) =>
        c.id === clusterId ? { ...c, access, accessUserIds: named } : c,
      ),
    }))
  },

  setItemAccess: async (itemId, access, userIds) => {
    await supabase.from('resource_items').update({ access }).eq('id', itemId)

    // The named list only means anything for 'specific', so it is cleared
    // otherwise rather than left behind to reappear later.
    await supabase.from('resource_item_access').delete().eq('item_id', itemId)
    const named = access === 'specific' ? userIds : []
    if (named.length > 0) {
      await supabase
        .from('resource_item_access')
        .insert(named.map((user_id) => ({ item_id: itemId, user_id })))
    }

    set((s) => ({
      items: s.items.map((i) =>
        i.id === itemId ? { ...i, access, accessUserIds: named } : i,
      ),
    }))
  },

  /** A genuine copy: separate row, separate file, same metadata and links. */
  duplicateItem: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId)
    if (!item) return null

    const { data, error } = await supabase
      .from('resource_items')
      .insert({
        project_id: item.projectId,
        cluster_id: item.clusterId,
        title: `${item.title} (copy)`,
        description: item.description,
        x: item.x + 40,
        y: item.y + 40,
        // Without this a copy of a document that lives in the space inherits
        // no location at all and is invisible everywhere.
        show_at_top_level: item.showAtTopLevel,
      })
      .select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id), resource_item_access(user_id)')
      .single()

    if (error || !data) return null
    let copy = toItem(data)

    // Copy the file itself so the two documents are genuinely independent.
    if (item.storagePath) {
      const path = `resources/${item.projectId}/${copy.id}-${(item.fileName ?? 'file').replace(/[^\w.-]+/g, '_')}`
      const { error: copyErr } = await supabase.storage.from(BUCKET).copy(item.storagePath, path)
      if (!copyErr) {
        await supabase
          .from('resource_items')
          .update({ storage_path: path, file_name: item.fileName, mime_type: item.mimeType, size: item.size })
          .eq('id', copy.id)
        copy = { ...copy, storagePath: path, fileName: item.fileName, mimeType: item.mimeType, size: item.size }
      }
    }

    if (item.links.length > 0) {
      await supabase.from('resource_item_links').insert(
        item.links.map((l, idx) => ({ item_id: copy.id, label: l.label, url: l.url, sort_order: idx }))
      )
      copy = { ...copy, links: item.links.map((l) => ({ ...l, itemId: copy.id })) }
    }

    if (item.clusterIds.length > 0) {
      await supabase
        .from('resource_item_clusters')
        .insert(item.clusterIds.map((cluster_id) => ({ item_id: copy.id, cluster_id })))
      copy = { ...copy, clusterIds: [...item.clusterIds] }
    }

    set((s) => ({ items: [...s.items, copy] }))
    return copy
  },

  // ─── Todos ────────────────────────────────────────────────────────────────

  // ─── Notes ────────────────────────────────────────────────────────────────

  loadNotes: async (projectId, ownerId = null) => {
    // The board belongs to exactly one owner: the shared manager board
    // (owner_id null) or one person's. Filtering here rather than in the page
    // keeps someone else's notes out of the store entirely.
    const query = supabase
      .from('project_notes')
      .select('*, project_note_items(*)')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })

    const { data, error } = await (ownerId
      ? query.eq('owner_id', ownerId)
      : query.is('owner_id', null))

    if (error) {
      // Before the migration runs the table does not exist. Treat that as an
      // empty board rather than letting the tab fail to render.
      console.error('[loadNotes] failed:', error)
      set({ notes: [], notesLoadedFor: `${projectId}:${ownerId ?? 'shared'}` })
      return
    }
    set({ notes: (data ?? []).map(toNote), notesLoadedFor: `${projectId}:${ownerId ?? 'shared'}` })
  },

  createNote: async (projectId, input = {}, ownerId = null) => {
    // New notes go to the top of the board, which is where you look for what
    // you just wrote.
    const minOrder = get().notes.reduce((min, n) => Math.min(min, n.sortOrder), 0)
    const { data, error } = await supabase
      .from('project_notes')
      .insert({
        project_id: projectId,
        owner_id: ownerId,
        title: input.title ?? '',
        body: input.body ?? '',
        content: input.content ?? '',
        color: input.color ?? '#fef3c7',
        is_pinned: input.isPinned ?? false,
        sort_order: minOrder - 1,
      })
      .select('*, project_note_items(*)')
      .single()

    if (error || !data) {
      console.error('[createNote] failed:', error)
      return null
    }
    const note = toNote(data)
    set((s) => ({ notes: [note, ...s.notes] }))
    return note
  },

  updateNote: async (id, updates) => {
    const patch: Record<string, unknown> = {}
    if (updates.title !== undefined) patch.title = updates.title
    if (updates.body !== undefined) patch.body = updates.body
    if (updates.content !== undefined) patch.content = updates.content
    if (updates.color !== undefined) patch.color = updates.color
    if (updates.isPinned !== undefined) patch.is_pinned = updates.isPinned
    if (updates.isArchived !== undefined) patch.is_archived = updates.isArchived
    if (updates.sortOrder !== undefined) patch.sort_order = updates.sortOrder
    if (Object.keys(patch).length === 0) return

    // Optimistic: typing in a note should never wait on the network.
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...updates } : n)) }))
    const { error } = await supabase.from('project_notes').update(patch).eq('id', id)
    if (error) console.error('[updateNote] failed:', error)
  },

  deleteNote: async (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
    const { error } = await supabase.from('project_notes').delete().eq('id', id)
    if (error) console.error('[deleteNote] failed:', error)
  },

  reorderNotes: async (orderedIds) => {
    set((s) => ({
      notes: s.notes.map((n) => {
        const i = orderedIds.indexOf(n.id)
        return i === -1 ? n : { ...n, sortOrder: i }
      }),
    }))
    await Promise.all(
      orderedIds.map((id, i) =>
        supabase.from('project_notes').update({ sort_order: i }).eq('id', id)
      )
    )
  },

  setNoteItems: async (noteId, items) => {
    // Replace wholesale: checklists are short, and this keeps ordering and
    // deletions correct without diffing.
    await supabase.from('project_note_items').delete().eq('note_id', noteId)

    let rows: any[] = []
    if (items.length) {
      const { data, error } = await supabase
        .from('project_note_items')
        .insert(
          items.map((it, i) => ({
            note_id: noteId,
            text: it.text,
            is_checked: it.isChecked,
            sort_order: i,
          }))
        )
        .select()
      if (error) console.error('[setNoteItems] failed:', error)
      rows = data ?? []
    }

    const mapped = rows.map(toNoteItem).sort((a, b) => a.sortOrder - b.sortOrder)
    set((s) => ({ notes: s.notes.map((n) => (n.id === noteId ? { ...n, items: mapped } : n)) }))
  },

  toggleNoteItem: async (noteId, itemId) => {
    const note = get().notes.find((n) => n.id === noteId)
    const item = note?.items.find((i) => i.id === itemId)
    if (!item) return

    const next = !item.isChecked
    set((s) => ({
      notes: s.notes.map((n) =>
        n.id !== noteId
          ? n
          : { ...n, items: n.items.map((i) => (i.id === itemId ? { ...i, isChecked: next } : i)) }
      ),
    }))
    const { error } = await supabase
      .from('project_note_items')
      .update({ is_checked: next })
      .eq('id', itemId)
    if (error) console.error('[toggleNoteItem] failed:', error)
  },

  loadTodos: async (projectId, ownerId = null) => {
    // Whose lists these are: the shared manager board (owner_id null) or one
    // person's. RLS enforces it too, but filtering here keeps the store to a
    // single board so the tabs never show someone else's list.
    const byOwner = <T extends { eq: any; is: any }>(q: T): T =>
      (ownerId ? q.eq('owner_id', ownerId) : q.is('owner_id', null)) as T

    // The shares join only resolves once the do-dates migration has run. Until
    // then the whole query 400s and the page looks empty even though the todos
    // are fine, so fall back to the columns that have always existed.
    const fetchTodos = async () => {
      const withShares = await byOwner(
        supabase
          .from('project_todos')
          .select('*, project_todo_links(*), project_todo_shares(user_id)')
          .eq('project_id', projectId)
          .order('sort_order')
      )

      if (!withShares.error) return withShares

      console.warn(
        '[loadTodos] falling back to the pre-migration shape:',
        withShares.error.message,
      )
      return byOwner(
        supabase
          .from('project_todos')
          .select('*, project_todo_links(*)')
          .eq('project_id', projectId)
          .order('sort_order')
      )
    }

    const [todosRes, listsRes] = await Promise.all([
      fetchTodos(),
      byOwner(
        supabase
          .from('project_todo_lists')
          .select('*')
          .eq('project_id', projectId)
          .order('sort_order')
      ),
    ])

    if (todosRes.error) console.error('[loadTodos] failed:', todosRes.error)

    let lists = (listsRes.data ?? []).map(toTodoList)

    // Every board needs at least one list for todos to live in.
    if (lists.length === 0) {
      const created = await get().createTodoList(projectId, 'To do', ownerId)
      if (created) lists = [created]
    }

    // Keyed by board, not just project: an admin stepping into an employee's
    // lists and back must refetch, and both are the same projectId.
    set({
      todos: (todosRes.data ?? []).map(toTodo),
      todoLists: lists,
      todosLoadedFor: `${projectId}:${ownerId ?? 'shared'}`,
    })
  },

  createTodoList: async (projectId, name, ownerId = null) => {
    const maxOrder = get().todoLists.reduce((max, l) => Math.max(max, l.sortOrder), -1)
    const { data, error } = await supabase
      .from('project_todo_lists')
      .insert({ project_id: projectId, owner_id: ownerId, name, sort_order: maxOrder + 1 })
      .select()
      .single()

    if (error || !data) return null
    const list = toTodoList(data)
    set((s) => ({ todoLists: [...s.todoLists, list] }))
    return list
  },

  updateTodoList: async (id, updates) => {
    const patch: Record<string, unknown> = {}
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.color !== undefined) patch.color = updates.color
    if (updates.sortOrder !== undefined) patch.sort_order = updates.sortOrder
    if (Object.keys(patch).length === 0) return

    await supabase.from('project_todo_lists').update(patch).eq('id', id)
    set((s) => ({ todoLists: s.todoLists.map((l) => (l.id === id ? { ...l, ...updates } : l)) }))
  },

  deleteTodoList: async (id) => {
    // Todos cascade in the DB; mirror that locally.
    await supabase.from('project_todo_lists').delete().eq('id', id)
    set((s) => ({
      todoLists: s.todoLists.filter((l) => l.id !== id),
      todos: s.todos.filter((t) => t.listId !== id),
    }))
  },

  /** A copy of the list plus every todo in it, links included. */
  duplicateTodoList: async (id) => {
    const source = get().todoLists.find((l) => l.id === id)
    if (!source) return null

    // The copy stays on the same board as the list it came from.
    const list = await get().createTodoList(source.projectId, `${source.name} (copy)`, source.ownerId)
    if (!list) return null

    const sourceTodos = get().todos
      .filter((t) => t.listId === id)
      .sort((a, b) => a.sortOrder - b.sortOrder)

    for (const todo of sourceTodos) {
      const copy = await get().createTodo(source.projectId, {
        listId: list.id,
        title: todo.title,
        notes: todo.notes,
        priority: todo.priority,
        dueDate: todo.dueDate,
      }, source.ownerId)
      if (copy && todo.links.length > 0) {
        await get().setTodoLinks(
          copy.id,
          todo.links.map((l) => ({ itemId: l.itemId ?? undefined, clusterId: l.clusterId ?? undefined }))
        )
      }
    }

    return list
  },

  moveTodoToList: async (todoId, listId) => {
    await supabase.from('project_todos').update({ list_id: listId }).eq('id', todoId)
    set((s) => ({ todos: s.todos.map((t) => (t.id === todoId ? { ...t, listId } : t)) }))
  },

  createTodo: async (projectId, input, ownerId = null) => {
    // Order is per-list, so only siblings in the target list matter.
    const maxOrder = get().todos.reduce(
      (max, t) => (t.listId === (input.listId ?? null) ? Math.max(max, t.sortOrder) : max),
      -1
    )
    const base = {
      project_id: projectId,
      // A todo belongs to whoever owns the list it lands in; RLS checks the
      // two agree, so this must match the list being written into.
      owner_id: ownerId,
      list_id: input.listId ?? null,
      title: input.title ?? 'New todo',
      notes: input.notes ?? '',
      priority: input.priority ?? 'medium',
      due_date: input.dueDate ?? null,
      sort_order: maxOrder + 1,
    }
    // Columns the do-dates migration adds. Dropped on retry if it hasn't run.
    const scheduling = {
      do_date: input.doDate ?? null,
      do_start: input.doStart ?? null,
      do_end: input.doEnd ?? null,
      assignee_id: input.assigneeId ?? null,
      visibility: input.visibility ?? null,
    }

    let { data, error } = await supabase
      .from('project_todos')
      .insert({ ...base, ...scheduling })
      .select('*, project_todo_links(*), project_todo_shares(user_id)')
      .single()

    if (error) {
      console.warn('[createTodo] retrying without the scheduling columns:', error.message)
      ;({ data, error } = await supabase
        .from('project_todos')
        .insert(base)
        .select('*, project_todo_links(*)')
        .single())
    }

    if (error || !data) {
      console.error('[createTodo] failed:', error)
      return null
    }
    const todo = toTodo(data)
    set((s) => ({ todos: [...s.todos, todo] }))
    return todo
  },

  updateTodo: async (id, updates) => {
    const patch: Record<string, unknown> = {}
    if (updates.title !== undefined) patch.title = updates.title
    if (updates.notes !== undefined) patch.notes = updates.notes
    if (updates.priority !== undefined) patch.priority = updates.priority
    if (updates.dueDate !== undefined) patch.due_date = updates.dueDate || null
    if (updates.doDate !== undefined) patch.do_date = updates.doDate || null
    if (updates.doStart !== undefined) patch.do_start = updates.doStart || null
    if (updates.doEnd !== undefined) patch.do_end = updates.doEnd || null
    if (updates.assigneeId !== undefined) patch.assignee_id = updates.assigneeId || null
    if (updates.visibility !== undefined) patch.visibility = updates.visibility || null
    if (updates.isCompleted !== undefined) {
      patch.is_completed = updates.isCompleted
      patch.completed_at = updates.isCompleted ? new Date().toISOString() : null
    }
    if (Object.keys(patch).length === 0) return

    const { error } = await supabase.from('project_todos').update(patch).eq('id', id)
    if (error) {
      // Before the do-dates migration these columns don't exist; keep the rest
      // of the edit rather than losing the whole change.
      const SCHEDULING = ['do_date', 'do_start', 'do_end', 'assignee_id', 'visibility']
      const legacy = Object.fromEntries(
        Object.entries(patch).filter(([k]) => !SCHEDULING.includes(k)),
      )
      console.warn('[updateTodo] retrying without the scheduling columns:', error.message)
      if (Object.keys(legacy).length === 0) return
      await supabase.from('project_todos').update(legacy).eq('id', id)
    }

    set((s) => ({
      todos: s.todos.map((t) =>
        t.id === id
          ? { ...t, ...updates, completedAt: (patch.completed_at as string | null) ?? t.completedAt }
          : t
      ),
    }))
  },

  toggleTodo: async (id) => {
    const todo = get().todos.find((t) => t.id === id)
    if (!todo) return
    await get().updateTodo(id, { isCompleted: !todo.isCompleted })
  },

  deleteTodo: async (id) => {
    await supabase.from('project_todos').delete().eq('id', id)
    set((s) => ({ todos: s.todos.filter((t) => t.id !== id) }))
  },

  reorderTodos: async (orderedIds) => {
    set((s) => ({
      todos: s.todos.map((t) => {
        const idx = orderedIds.indexOf(t.id)
        return idx === -1 ? t : { ...t, sortOrder: idx }
      }),
    }))

    await Promise.all(
      orderedIds.map((id, idx) => supabase.from('project_todos').update({ sort_order: idx }).eq('id', id))
    )
  },

  setTodoLinks: async (todoId, links) => {
    await supabase.from('project_todo_links').delete().eq('todo_id', todoId)

    const rows = links
      .filter((l) => l.itemId || l.clusterId)
      .map((l) => ({ todo_id: todoId, item_id: l.itemId ?? null, cluster_id: l.clusterId ?? null }))

    let saved: ProjectTodoLink[] = []
    if (rows.length > 0) {
      const { data } = await supabase.from('project_todo_links').insert(rows).select()
      saved = (data ?? []).map(toTodoLink)
    }

    set((s) => ({ todos: s.todos.map((t) => (t.id === todoId ? { ...t, links: saved } : t)) }))
  },

  setTodoShares: async (todoId, userIds) => {
    await supabase.from('project_todo_shares').delete().eq('todo_id', todoId)
    if (userIds.length > 0) {
      await supabase
        .from('project_todo_shares')
        .insert(userIds.map((user_id) => ({ todo_id: todoId, user_id })))
    }
    set((s) => ({
      todos: s.todos.map((t) => (t.id === todoId ? { ...t, sharedWith: userIds } : t)),
    }))
  },

  // ─── Calendar ─────────────────────────────────────────────────────────────

  calendarEntries: [],
  calendarLoadedFor: null,

  /**
   * Entries for one project, plus the viewer's own project-less ones (personal
   * busy blocks and working hours, which apply wherever they are). RLS decides
   * what actually comes back.
   */
  loadCalendar: async (projectId) => {
    const run = (select: string) => {
      const q = supabase.from('calendar_entries').select(select).order('starts_at')
      return projectId
        ? q.or(`project_id.eq.${projectId},project_id.is.null`)
        : q.is('project_id', null)
    }

    // The links join needs its own migration; fall back rather than losing the
    // whole calendar when only that part is missing.
    let { data, error } = await run('*, calendar_entry_shares(user_id), calendar_entry_links(*)')
    if (error) {
      console.warn('[loadCalendar] retrying without entry links:', error.message)
      ;({ data, error } = await run('*, calendar_entry_shares(user_id)'))
    }
    // Missing table = the do-dates migration hasn't run either. The rest of the
    // calendar (the todos' do dates) still works, so don't fail hard.
    if (error) console.warn('[loadCalendar] no calendar entries:', error.message)

    set({
      calendarEntries: error || !data ? [] : (data as any[]).map(toCalendarEntry),
      calendarLoadedFor: projectId,
    })
  },

  createCalendarEntry: async (input) => {
    const { data: auth } = await supabase.auth.getUser()
    const ownerId = input.ownerId ?? auth.user?.id
    if (!ownerId) return null

    const row = {
      project_id: input.projectId ?? null,
      owner_id: ownerId,
      title: input.title ?? 'Busy',
      notes: input.notes ?? '',
      kind: input.kind ?? 'busy',
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      all_day: input.allDay ?? false,
      visibility: input.visibility ?? null,
    }

    const insert = (select: string) =>
      supabase.from('calendar_entries').insert(row).select(select).single()

    // The links join needs its own migration; retry without it rather than
    // failing the insert outright.
    let { data, error } = await insert('*, calendar_entry_shares(user_id), calendar_entry_links(*)')
    if (error) {
      console.warn('[createCalendarEntry] retrying without entry links:', error.message)
      ;({ data, error } = await insert('*, calendar_entry_shares(user_id)'))
    }

    if (error || !data) {
      console.error('[createCalendarEntry] failed:', error)
      return null
    }
    const entry = toCalendarEntry(data)
    set((s) => ({ calendarEntries: [...s.calendarEntries, entry] }))
    return entry
  },

  updateCalendarEntry: async (id, updates) => {
    const patch: Record<string, unknown> = {}
    if (updates.title !== undefined) patch.title = updates.title
    if (updates.notes !== undefined) patch.notes = updates.notes
    if (updates.kind !== undefined) patch.kind = updates.kind
    if (updates.startsAt !== undefined) patch.starts_at = updates.startsAt
    if (updates.endsAt !== undefined) patch.ends_at = updates.endsAt
    if (updates.allDay !== undefined) patch.all_day = updates.allDay
    if (updates.visibility !== undefined) patch.visibility = updates.visibility || null
    if (Object.keys(patch).length === 0) return

    // Optimistic: dragging an entry around the calendar must not snap back.
    set((s) => ({
      calendarEntries: s.calendarEntries.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    }))
    await supabase.from('calendar_entries').update(patch).eq('id', id)
  },

  deleteCalendarEntry: async (id) => {
    await supabase.from('calendar_entries').delete().eq('id', id)
    set((s) => ({ calendarEntries: s.calendarEntries.filter((e) => e.id !== id) }))
  },

  setCalendarEntryLinks: async (entryId, links) => {
    await supabase.from('calendar_entry_links').delete().eq('entry_id', entryId)

    const rows = links
      .filter((l) => l.itemId || l.clusterId)
      .map((l) => ({ entry_id: entryId, item_id: l.itemId ?? null, cluster_id: l.clusterId ?? null }))

    let saved: CalendarEntry['links'] = []
    if (rows.length > 0) {
      const { data } = await supabase.from('calendar_entry_links').insert(rows).select()
      saved = (data ?? []).map((l: any) => ({
        id: l.id,
        entryId: l.entry_id,
        itemId: l.item_id,
        clusterId: l.cluster_id,
      }))
    }

    set((s) => ({
      calendarEntries: s.calendarEntries.map((e) => (e.id === entryId ? { ...e, links: saved } : e)),
    }))
  },
}))
