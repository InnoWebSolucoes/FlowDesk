// Folder sync: mirrors FlowDesk's Projects → Clusters tree into a local folder
// and uploads any file saved there into the matching cluster in the app.
//
// The upload recipe deliberately follows createItem in src/store/projectStore.ts:
//   1. insert resource_items (show_at_top_level = true when outside any cluster)
//   2. upload bytes to attachments at resources/{projectId}/{itemId}-{safeName}
//   3. patch the row with storage_path / file_name / mime_type / size
//   4. tag the home cluster in resource_item_clusters
//
// Auth: no session is stored here. Every operation borrows the current access
// token from the logged-in FlowDesk pane, so RLS applies to the real user and
// there is no refresh-token tug-of-war with the pane's own supabase client.

const { createClient } = require('@supabase/supabase-js')
const { Notification } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const BUCKET = 'attachments'
const PARTIAL_EXT = new Set(['.crdownload', '.tmp', '.part', '.partial', '.download'])
const MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.json': 'application/json',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sanitizeName(name) {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return cleaned || 'Untitled'
}

class FlowdeskSync {
  constructor({ root, supabaseUrl, supabaseAnonKey, getAccessToken }) {
    this.root = root
    this.supabaseUrl = supabaseUrl
    this.supabaseAnonKey = supabaseAnonKey
    this.getAccessToken = getAccessToken
    this.metaDir = path.join(root, '.flowdesk')
    this.mapping = {} // folder relPath -> { id, type, projectId, clusterId }
    this.manifest = {} // file relPath -> { size, mtimeMs, itemId, storagePath }
    this.pending = new Map() // absPath -> timeout
    this.watcher = null
    this.timer = null
    this.stopped = false
  }

  log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`
    try {
      fs.appendFileSync(path.join(this.metaDir, 'sync.log'), line)
    } catch {}
    console.log('[sync]', msg)
  }

  notify(title, body) {
    try {
      new Notification({ title, body }).show()
    } catch {}
  }

  loadState() {
    const read = (f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(this.metaDir, f), 'utf8'))
      } catch {
        return {}
      }
    }
    this.mapping = read('mapping.json')
    this.manifest = read('manifest.json')
  }

  saveState() {
    try {
      fs.writeFileSync(path.join(this.metaDir, 'mapping.json'), JSON.stringify(this.mapping, null, 2))
      fs.writeFileSync(path.join(this.metaDir, 'manifest.json'), JSON.stringify(this.manifest, null, 2))
    } catch (e) {
      this.log(`could not save state: ${e.message}`)
    }
  }

  async client() {
    const token = await this.getAccessToken()
    if (!token) return null
    return createClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
  }

  absOf(rel) {
    return path.join(this.root, ...rel.split('/'))
  }

  relOf(abs) {
    return path.relative(this.root, abs).split(path.sep).join('/')
  }

  isIgnored(rel) {
    if (rel.split('/').some((seg) => seg.startsWith('.') || seg.startsWith('~$'))) return true
    return PARTIAL_EXT.has(path.extname(rel).toLowerCase())
  }

  async start() {
    await fsp.mkdir(this.metaDir, { recursive: true })
    this.loadState()
    this.watch()
    const tick = async () => {
      if (this.stopped) return
      let signedIn = false
      try {
        signedIn = await this.syncTree()
      } catch (e) {
        this.log(`tree sync failed: ${e.message}`)
      }
      // Retry quickly until the user has logged into the FlowDesk pane.
      this.timer = setTimeout(tick, signedIn ? 5 * 60 * 1000 : 60 * 1000)
    }
    tick()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    if (this.watcher) this.watcher.close()
    for (const t of this.pending.values()) clearTimeout(t)
  }

  /** Mirror projects/clusters into folders. Returns false when not signed in yet. */
  async syncTree() {
    const supabase = await this.client()
    if (!supabase) {
      this.log('FlowDesk pane not signed in yet — folder sync waiting.')
      return false
    }

    const [projectsRes, clustersRes] = await Promise.all([
      supabase.from('projects').select('id,name,is_archived').order('created_at'),
      supabase.from('resource_clusters').select('id,project_id,parent_cluster_id,title').order('created_at'),
    ])
    if (projectsRes.error) throw projectsRes.error
    if (clustersRes.error) throw clustersRes.error
    const projects = (projectsRes.data ?? []).filter((p) => !p.is_archived)
    const clusters = clustersRes.data ?? []

    // Desired relPath per entity, parents before children. Sibling name
    // collisions get a short id suffix so the mapping stays unambiguous.
    const usedByParent = new Map()
    const takeName = (parentRel, base, id) => {
      let set = usedByParent.get(parentRel)
      if (!set) usedByParent.set(parentRel, (set = new Set()))
      let name = base
      if (set.has(name.toLowerCase())) name = `${base} (${id.slice(0, 8)})`
      set.add(name.toLowerCase())
      return name
    }

    const idPath = new Map()
    const newMapping = {}
    for (const p of projects) {
      const rel = takeName('', sanitizeName(p.name), p.id)
      idPath.set(p.id, rel)
      newMapping[rel] = { id: p.id, type: 'project', projectId: p.id, clusterId: null }
    }
    let queue = clusters.slice()
    let progressed = true
    while (progressed) {
      progressed = false
      const rest = []
      for (const c of queue) {
        const parentRel = c.parent_cluster_id ? idPath.get(c.parent_cluster_id) : idPath.get(c.project_id)
        if (parentRel === undefined) {
          rest.push(c) // parent not placed yet (or belongs to an archived project)
          continue
        }
        const rel = `${parentRel}/${takeName(parentRel, sanitizeName(c.title), c.id)}`
        idPath.set(c.id, rel)
        newMapping[rel] = { id: c.id, type: 'cluster', projectId: c.project_id, clusterId: c.id }
        progressed = true
      }
      queue = rest
    }

    // Apply to disk. Parents come first in idPath, so a renamed project moves
    // its children with it; migratePrefix keeps manifest/old-path bookkeeping
    // in step so moved files are not re-uploaded as duplicates.
    const oldIdPath = new Map(Object.entries(this.mapping).map(([rel, m]) => [m.id, rel]))
    const migratePrefix = (oldRel, newRel) => {
      for (const [id, rel] of oldIdPath) {
        if (rel === oldRel || rel.startsWith(oldRel + '/')) {
          oldIdPath.set(id, newRel + rel.slice(oldRel.length))
        }
      }
      for (const key of Object.keys(this.manifest)) {
        if (key.startsWith(oldRel + '/')) {
          this.manifest[newRel + key.slice(oldRel.length)] = this.manifest[key]
          delete this.manifest[key]
        }
      }
    }
    for (const [id, rel] of idPath) {
      const oldRel = oldIdPath.get(id)
      const abs = this.absOf(rel)
      if (oldRel && oldRel !== rel && fs.existsSync(this.absOf(oldRel)) && !fs.existsSync(abs)) {
        await fsp.mkdir(path.dirname(abs), { recursive: true })
        try {
          await fsp.rename(this.absOf(oldRel), abs)
          migratePrefix(oldRel, rel)
          this.log(`renamed "${oldRel}" -> "${rel}"`)
        } catch (e) {
          this.log(`rename failed for "${oldRel}": ${e.message}`)
        }
      }
      await fsp.mkdir(abs, { recursive: true })
    }

    this.mapping = newMapping
    this.saveState()
    this.log(`tree synced: ${projects.length} projects, ${clusters.length} clusters`)
    await this.scan()
    return true
  }

  /** Queue any file on disk that the manifest doesn't know about yet. */
  async scan() {
    for (const rel of Object.keys(this.mapping)) {
      let entries
      try {
        entries = await fsp.readdir(this.absOf(rel), { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (!e.isFile()) continue
        const fileRel = `${rel}/${e.name}`
        if (this.isIgnored(fileRel)) continue
        this.schedule(this.absOf(fileRel))
      }
    }
  }

  watch() {
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, (_ev, fname) => {
        if (!fname) return
        const rel = fname.split(path.sep).join('/')
        if (this.isIgnored(rel)) return
        this.schedule(path.join(this.root, fname))
      })
    } catch (e) {
      this.log(`watcher failed to start: ${e.message}`)
    }
  }

  schedule(abs, delay = 1500) {
    clearTimeout(this.pending.get(abs))
    this.pending.set(
      abs,
      setTimeout(() => {
        this.pending.delete(abs)
        this.process(abs).catch((e) => {
          this.log(`upload failed for ${abs}: ${e.message}`)
          this.notify('FlowDesk sync failed', `${path.basename(abs)} — will retry. See sync.log.`)
          this.schedule(abs, 60 * 1000)
        })
      }, delay),
    )
  }

  async process(abs) {
    let st
    try {
      st = await fsp.stat(abs)
    } catch {
      return // deleted or moved before we got to it
    }
    if (!st.isFile()) return
    const rel = this.relOf(abs)
    if (rel.startsWith('..')) return
    const known = this.manifest[rel]
    if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) return

    // Wait for the file to stop changing (still being written by the save).
    await sleep(1200)
    let st2
    try {
      st2 = await fsp.stat(abs)
    } catch {
      return
    }
    if (st2.size !== st.size || st2.mtimeMs !== st.mtimeMs) {
      this.schedule(abs)
      return
    }

    const dirRel = rel.split('/').slice(0, -1).join('/')
    const target = this.mapping[dirRel]
    if (!target) {
      this.log(`no FlowDesk mapping for folder "${dirRel || '(root)'}" — skipped ${rel}`)
      return
    }

    const supabase = await this.client()
    if (!supabase) {
      this.log(`not signed in — ${rel} queued for retry`)
      this.schedule(abs, 60 * 1000)
      return
    }

    const name = path.basename(abs)
    const contentType = MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
    const buf = await fsp.readFile(abs)

    if (known?.itemId && known.storagePath) {
      // Same file changed on disk: replace the bytes in place.
      const up = await supabase.storage.from(BUCKET).upload(known.storagePath, buf, { upsert: true, contentType })
      if (up.error) throw new Error(up.error.message)
      await supabase
        .from('resource_items')
        .update({ size: st2.size, updated_at: new Date().toISOString() })
        .eq('id', known.itemId)
      this.manifest[rel] = { ...known, size: st2.size, mtimeMs: st2.mtimeMs }
      this.saveState()
      this.notify('FlowDesk updated', `${name} — file replaced in the app`)
      this.log(`replaced ${rel} (item ${known.itemId})`)
      return
    }

    const inserted = await supabase
      .from('resource_items')
      .insert({
        project_id: target.projectId,
        cluster_id: target.clusterId,
        title: name,
        description: '',
        x: Math.round(Math.random() * 240 - 120),
        y: Math.round(Math.random() * 240 - 120),
        show_at_top_level: target.clusterId === null,
      })
      .select('id')
      .single()
    if (inserted.error) throw new Error(inserted.error.message)
    const itemId = inserted.data.id

    const safe = name.replace(/[^\w.-]+/g, '_')
    const storagePath = `resources/${target.projectId}/${itemId}-${safe}`
    const up = await supabase.storage.from(BUCKET).upload(storagePath, buf, { upsert: true, contentType })
    if (up.error) {
      await supabase.from('resource_items').delete().eq('id', itemId)
      throw new Error(up.error.message)
    }
    await supabase
      .from('resource_items')
      .update({ storage_path: storagePath, file_name: name, mime_type: contentType, size: st2.size })
      .eq('id', itemId)
    if (target.clusterId) {
      await supabase.from('resource_item_clusters').insert({ item_id: itemId, cluster_id: target.clusterId })
    }

    this.manifest[rel] = { size: st2.size, mtimeMs: st2.mtimeMs, itemId, storagePath }
    this.saveState()
    this.notify('Saved to FlowDesk', `${name} → ${dirRel.split('/').join(' / ')}`)
    this.log(`uploaded ${rel} → item ${itemId}`)
  }
}

module.exports = { FlowdeskSync }
