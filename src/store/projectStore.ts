import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import {
  Project, ResourceCluster, ResourceItem, ResourceItemLink, ResourceItemVersion,
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
  moveItem: (id: string, clusterId: string | null, x: number, y: number, fromClusterId?: string | null) => Promise<void>

  setItemLinks: (itemId: string, links: { id?: string; label: string; url: string }[]) => Promise<void>
  getFileUrl: (storagePath: string) => Promise<string | null>

  // Versions: a stack of file iterations under one document.
  addItemVersion: (itemId: string, file: File, label?: string) => Promise<void>
  makeVersionCurrent: (itemId: string, versionId: string) => Promise<void>
  deleteItemVersion: (itemId: string, versionId: string) => Promise<void>

  // Tags: the clusters a document appears in, beyond its home.
  setItemClusters: (itemId: string, clusterIds: string[]) => Promise<void>
  duplicateItem: (itemId: string) => Promise<ResourceItem | null>

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
      supabase.from('resource_items').select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id)').eq('project_id', projectId),
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
        // Created outside any cluster means it lives in the main space.
        show_at_top_level: clusterId === null,
      })
      .select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id)')
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
      .select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id)')
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
      .select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id)')
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
      })
      .select('*, resource_item_links(*), resource_item_versions(*), resource_item_clusters(cluster_id)')
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
