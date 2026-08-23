import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import {
  Project, ResourceCluster, ResourceItem, ResourceItemLink,
  ProjectTodo, ProjectTodoLink, ProjectTodoList,
} from '../types'

const BUCKET = 'attachments'

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

  createProject: (input: Partial<Project> & { name: string }) => Promise<Project | null>
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  getProject: (id: string) => Project | undefined

  // Resources
  loadResources: (projectId: string) => Promise<void>
  createCluster: (projectId: string, parentClusterId: string | null, input: Partial<ResourceCluster>) => Promise<ResourceCluster | null>
  updateCluster: (id: string, updates: Partial<ResourceCluster>) => Promise<void>
  deleteCluster: (id: string) => Promise<void>

  createItem: (projectId: string, clusterId: string | null, input: Partial<ResourceItem>, file?: File) => Promise<ResourceItem | null>
  updateItem: (id: string, updates: Partial<ResourceItem>) => Promise<void>
  replaceItemFile: (id: string, file: File) => Promise<void>
  removeItemFile: (id: string) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  moveItem: (id: string, clusterId: string | null, x: number, y: number) => Promise<void>

  setItemLinks: (itemId: string, links: { id?: string; label: string; url: string }[]) => Promise<void>
  getFileUrl: (storagePath: string) => Promise<string | null>

  // Todo lists
  todoLists: ProjectTodoList[]
  createTodoList: (projectId: string, name: string) => Promise<ProjectTodoList | null>
  updateTodoList: (id: string, updates: Partial<ProjectTodoList>) => Promise<void>
  deleteTodoList: (id: string) => Promise<void>
  moveTodoToList: (todoId: string, listId: string) => Promise<void>

  // Todos
  loadTodos: (projectId: string) => Promise<void>
  createTodo: (projectId: string, input: Partial<ProjectTodo>) => Promise<ProjectTodo | null>
  updateTodo: (id: string, updates: Partial<ProjectTodo>) => Promise<void>
  toggleTodo: (id: string) => Promise<void>
  deleteTodo: (id: string) => Promise<void>
  reorderTodos: (orderedIds: string[]) => Promise<void>
  setTodoLinks: (todoId: string, links: { itemId?: string; clusterId?: string }[]) => Promise<void>
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

function toItem(row: any): ResourceItem {
  return {
    id: row.id,
    projectId: row.project_id,
    clusterId: row.cluster_id,
    title: row.title,
    description: row.description ?? '',
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: row.size,
    x: row.x,
    y: row.y,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    links: (row.resource_item_links ?? []).map(toItemLink).sort((a: ResourceItemLink, b: ResourceItemLink) => a.sortOrder - b.sortOrder),
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
    name: row.name,
    color: row.color ?? '#6366f1',
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
  }
}

function toTodo(row: any): ProjectTodo {
  return {
    id: row.id,
    projectId: row.project_id,
    listId: row.list_id ?? null,
    title: row.title,
    notes: row.notes ?? '',
    priority: row.priority,
    isCompleted: row.is_completed,
    completedAt: row.completed_at,
    dueDate: row.due_date,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    links: (row.project_todo_links ?? []).map(toTodoLink),
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
  loading: false,
  initialized: false,
  resourcesLoadedFor: null,
  todosLoadedFor: null,

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
    }))
  },

  getProject: (id) => get().projects.find((p) => p.id === id),

  // ─── Resources ────────────────────────────────────────────────────────────

  loadResources: async (projectId) => {
    const [clustersRes, itemsRes] = await Promise.all([
      supabase.from('resource_clusters').select('*').eq('project_id', projectId),
      supabase.from('resource_items').select('*, resource_item_links(*)').eq('project_id', projectId),
    ])

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

    await supabase.from('resource_clusters').update(patch).eq('id', id)
    set((s) => ({ clusters: s.clusters.map((c) => (c.id === id ? { ...c, ...updates } : c)) }))
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

  createItem: async (projectId, clusterId, input, file) => {
    const { data, error } = await supabase
      .from('resource_items')
      .insert({
        project_id: projectId,
        cluster_id: clusterId,
        title: input.title ?? file?.name ?? 'Untitled',
        description: input.description ?? '',
        x: input.x ?? 0,
        y: input.y ?? 0,
      })
      .select('*, resource_item_links(*)')
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

  moveItem: async (id, clusterId, x, y) => {
    await supabase.from('resource_items').update({ cluster_id: clusterId, x, y }).eq('id', id)
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, clusterId, x, y } : i)) }))
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

  // ─── Todos ────────────────────────────────────────────────────────────────

  loadTodos: async (projectId) => {
    const [todosRes, listsRes] = await Promise.all([
      supabase
        .from('project_todos')
        .select('*, project_todo_links(*)')
        .eq('project_id', projectId)
        .order('sort_order'),
      supabase
        .from('project_todo_lists')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order'),
    ])

    let lists = (listsRes.data ?? []).map(toTodoList)

    // Every project needs at least one list for todos to live in.
    if (lists.length === 0) {
      const created = await get().createTodoList(projectId, 'To do')
      if (created) lists = [created]
    }

    set({ todos: (todosRes.data ?? []).map(toTodo), todoLists: lists, todosLoadedFor: projectId })
  },

  createTodoList: async (projectId, name) => {
    const maxOrder = get().todoLists.reduce((max, l) => Math.max(max, l.sortOrder), -1)
    const { data, error } = await supabase
      .from('project_todo_lists')
      .insert({ project_id: projectId, name, sort_order: maxOrder + 1 })
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

  moveTodoToList: async (todoId, listId) => {
    await supabase.from('project_todos').update({ list_id: listId }).eq('id', todoId)
    set((s) => ({ todos: s.todos.map((t) => (t.id === todoId ? { ...t, listId } : t)) }))
  },

  createTodo: async (projectId, input) => {
    // Order is per-list, so only siblings in the target list matter.
    const maxOrder = get().todos.reduce(
      (max, t) => (t.listId === (input.listId ?? null) ? Math.max(max, t.sortOrder) : max),
      -1
    )
    const { data, error } = await supabase
      .from('project_todos')
      .insert({
        project_id: projectId,
        list_id: input.listId ?? null,
        title: input.title ?? 'New todo',
        notes: input.notes ?? '',
        priority: input.priority ?? 'medium',
        due_date: input.dueDate ?? null,
        sort_order: maxOrder + 1,
      })
      .select('*, project_todo_links(*)')
      .single()

    if (error || !data) return null
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
    if (updates.isCompleted !== undefined) {
      patch.is_completed = updates.isCompleted
      patch.completed_at = updates.isCompleted ? new Date().toISOString() : null
    }
    if (Object.keys(patch).length === 0) return

    await supabase.from('project_todos').update(patch).eq('id', id)
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
}))
