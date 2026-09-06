import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Send, Paperclip, Search, MessageSquare, CheckSquare, Trash2, Download,
  FolderOpen, X, Link2, ArrowRight,
} from 'lucide-react'
import { format, isToday, isYesterday, parseISO } from 'date-fns'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { useTaskStore } from '../store/taskStore'
import { useProjectStore } from '../store/projectStore'
import { ResourceLinkPicker, LinkKey } from '../components/shared/ResourceLinkPicker'
import { FileKindIcon, formatFileSize } from '../components/resources/ResourceThumbnail'
import { Conversation, ResourceItem } from '../types'
import { withHighlight } from '../lib/highlight'
import { useT } from '../i18n/useT'

/** Where a document sent in chat should be filed, beyond the room's own folder. */
type UploadTarget = { clusterId: string | null; label: string }

function initials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/** A day separator, the way a messaging app breaks up a long thread. */
function dayLabel(iso: string) {
  const d = parseISO(iso)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'EEEE, d MMM yyyy')
}

export function Chat() {
  const { t } = useT()
  const navigate = useNavigate()
  const { currentUser } = useAuthStore()
  const { allTasks } = useTaskStore()
  const {
    conversations, messages, loadMessages, sendMessage, deleteMessage,
    openDirect, openTaskRoom, ensureCluster, markRead, unreadCount, loadedRooms,
    people, error, clearError,
  } = useChatStore()
  const {
    items, createItem, setItemClusters, loadResources, resourcesLoadedFor, getFileUrl,
  } = useProjectStore()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [pendingItems, setPendingItems] = useState<ResourceItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [picking, setPicking] = useState(false)
  const [choosingTarget, setChoosingTarget] = useState<File[] | null>(null)
  const [sending, setSending] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const me = currentUser?.id ?? ''
  const isAdmin = currentUser?.role === 'admin'

  // ─── Which room is open ───────────────────────────────────────────────────
  // ?conversation=<id> is how a notification lands on the room it is about.
  useEffect(() => {
    const wanted = searchParams.get('conversation')
    if (!wanted) return
    setActiveId(wanted)
    searchParams.delete('conversation')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])

  // ?task=<id> opens (or starts) that task's room, which is how the task card's
  // discussion button gets here.
  useEffect(() => {
    const wanted = searchParams.get('task')
    if (!wanted) return
    const task = allTasks.find((x) => x.id === wanted)
    if (!task) return
    searchParams.delete('task')
    setSearchParams(searchParams, { replace: true })
    openTaskRoom(task.id, task.projectId).then((c) => {
      if (c) setActiveId(c.id)
    })
  }, [searchParams, setSearchParams, allTasks, openTaskRoom])

  // ?user=<id> opens (or starts) a direct chat with that person.
  useEffect(() => {
    const wanted = searchParams.get('user')
    if (!wanted) return
    searchParams.delete('user')
    setSearchParams(searchParams, { replace: true })
    openDirect(wanted).then((c) => {
      if (c) setActiveId(c.id)
    })
  }, [searchParams, setSearchParams, openDirect])

  const active = activeId ? conversations.find((c) => c.id === activeId) ?? null : null

  // Opening a room fetches its history once, and marks it read.
  useEffect(() => {
    if (!activeId) return
    if (!loadedRooms.includes(activeId)) loadMessages(activeId)
    markRead(activeId)
  }, [activeId, loadedRooms, loadMessages, markRead])

  // Resources back the document chips and the upload targets. A manager may be
  // in rooms across projects, so this follows the open room rather than a
  // single project.
  const activeProjectId = useMemo(() => {
    if (!active) return currentUser?.projectId ?? null
    if (active.projectId) return active.projectId
    if (active.taskId) return allTasks.find((x) => x.id === active.taskId)?.projectId ?? null
    // A direct room has no project of its own; use the people in it.
    const other = active.memberIds.find((id) => id !== me)
    return people.find((p) => p.id === other)?.projectId ?? currentUser?.projectId ?? null
  }, [active, allTasks, people, me, currentUser])

  useEffect(() => {
    if (activeProjectId && resourcesLoadedFor !== activeProjectId) loadResources(activeProjectId)
  }, [activeProjectId, resourcesLoadedFor, loadResources])

  const roomMessages = activeId ? messages[activeId] ?? [] : []

  // Stay pinned to the newest message, the way a chat should.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [roomMessages.length, activeId])

  // ─── The conversation list ────────────────────────────────────────────────

  const nameOf = (userId: string) => {
    if (userId === me) return currentUser?.name ?? 'You'
    return people.find((p) => p.id === userId)?.name ?? 'Someone'
  }

  /** What a room is called in the list: the other person, or the task. */
  const titleOf = (c: Conversation) => {
    if (c.kind === 'task') {
      return allTasks.find((x) => x.id === c.taskId)?.title ?? 'Task'
    }
    const other = c.memberIds.find((id) => id !== me)
    return other ? nameOf(other) : 'Direct message'
  }

  const q = query.trim().toLowerCase()

  const directRooms = conversations
    .filter((c) => c.kind === 'direct')
    .filter((c) => !q || titleOf(c).toLowerCase().includes(q))

  const taskRooms = conversations
    .filter((c) => c.kind === 'task')
    .filter((c) => !q || titleOf(c).toLowerCase().includes(q))

  /**
   * Everyone you could start a chat with who you have no room with yet. A
   * manager can reach the whole company; an employee, their own project.
   */
  const startable = useMemo(() => {
    const already = new Set(
      conversations.filter((c) => c.kind === 'direct').flatMap((c) => c.memberIds)
    )
    return people
      .filter((p) => p.id !== me && !already.has(p.id))
      // A manager reaches everyone. An employee reaches their own project —
      // and every manager, who belong to no single project and would otherwise
      // be unreachable by the people they manage.
      .filter((p) => isAdmin || p.role === 'admin' || p.projectId === currentUser?.projectId)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
  }, [people, conversations, me, isAdmin, currentUser, q])

  // ─── Sending ──────────────────────────────────────────────────────────────

  /**
   * Files picked in chat become real project documents, not thread-only
   * attachments. Every one is filed in the room's own folder, and the target
   * chooser can put it in another cluster as well.
   */
  const uploadInto = async (files: File[], target: UploadTarget) => {
    if (!active || !activeProjectId) return
    const activeId = active.id
    setUploading(true)
    try {
      const roomCluster = await ensureCluster(activeId, titleOf(active))
      for (const file of files) {
        // The room's folder is the home; a chosen cluster is where it also
        // appears, so the document is never only in one place the sender knows.
        const home = target.clusterId ?? roomCluster
        const created = await createItem(
          activeProjectId,
          home,
          { title: file.name, description: '' },
          file
        )
        if (!created) continue

        // Filed in both, when the sender chose somewhere other than the room:
        // the room's folder is what makes a chat file findable later, so it is
        // added as a second tag rather than being replaced by the choice.
        if (target.clusterId && roomCluster && target.clusterId !== roomCluster) {
          await setItemClusters(created.id, [
            ...new Set([...created.clusterIds, roomCluster]),
          ])
        }
        setPendingItems((prev) => [...prev, created])
      }
    } finally {
      setUploading(false)
      setChoosingTarget(null)
    }
  }

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (files.length === 0) return
    // Ask where it should be filed before uploading; the room's folder is the
    // default, so this is one keystroke away from being skipped.
    setChoosingTarget(files)
  }

  const handleSend = async () => {
    if (!activeId) return
    if (!draft.trim() && pendingItems.length === 0) return
    setSending(true)
    try {
      await sendMessage(activeId, draft, pendingItems.map((i) => i.id))
      setDraft('')
      setPendingItems([])
    } finally {
      setSending(false)
    }
  }

  const download = async (item: ResourceItem) => {
    if (!item.storagePath) {
      if (item.links[0]) window.open(item.links[0].url, '_blank', 'noopener,noreferrer')
      return
    }
    const url = await getFileUrl(item.storagePath)
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = item.fileName ?? item.title
    a.click()
  }

  /** Take the reader from a task room to the task it is about. */
  const goToTask = (taskId: string) => {
    const task = allTasks.find((x) => x.id === taskId)
    if (!task) return
    navigate(
      withHighlight(
        isAdmin
          ? `/admin/projects/${task.projectId}/employees/tasks`
          : '/employee/tasks',
        taskId
      )
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const RoomRow = ({ c }: { c: Conversation }) => {
    const unread = unreadCount(c.id)
    const isActive = c.id === activeId
    const title = titleOf(c)
    return (
      <button
        onClick={() => setActiveId(c.id)}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors ${
          isActive ? 'bg-primary text-white' : 'hover:bg-surface-2'
        }`}
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
            c.kind === 'task'
              ? isActive ? 'bg-white/20' : 'bg-amber/15'
              : isActive ? 'bg-white/20' : 'bg-primary'
          }`}
        >
          {c.kind === 'task' ? (
            <CheckSquare size={14} className={isActive ? 'text-white' : 'text-amber'} />
          ) : (
            <span className="text-white text-[10px] font-bold">{initials(title)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${isActive ? 'text-white' : 'text-text-main'}`}>
            {title}
          </p>
          <p className={`text-[11px] truncate ${isActive ? 'text-white/70' : 'text-text-subtle'}`}>
            {c.kind === 'task' ? t('chat_taskThread') : t('chat_direct')}
          </p>
        </div>
        {unread > 0 && !isActive && (
          <span className="min-w-[18px] h-[18px] bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 flex-shrink-0">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    )
  }

  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="mb-4">
      <p className="text-[11px] font-semibold text-text-subtle uppercase tracking-wide px-3 mb-1">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )

  return (
    <div className="flex h-full -m-6 bg-bg relative">
      {/* Chat failing quietly reads as chat being broken, so whatever went
          wrong says so here rather than only in the console. */}
      {error && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-danger text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-lg">
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="flex-shrink-0 hover:opacity-70">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ─── Rooms ─────────────────────────────────────────────────────── */}
      <div className="w-72 border-r border-border bg-surface flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('chat_searchPlaceholder')}
              className="w-full bg-surface-2 border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-text-main placeholder-text-subtle outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {directRooms.length > 0 && (
            <Section label={t('chat_people')}>
              {directRooms.map((c) => <RoomRow key={c.id} c={c} />)}
            </Section>
          )}

          {taskRooms.length > 0 && (
            <Section label={t('chat_taskThreads')}>
              {taskRooms.map((c) => <RoomRow key={c.id} c={c} />)}
            </Section>
          )}

          {startable.length > 0 && (
            <Section label={t('chat_startChat')}>
              {startable.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openDirect(p.id).then((c) => c && setActiveId(c.id))}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left hover:bg-surface-2 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center flex-shrink-0">
                    <span className="text-text-muted text-[10px] font-bold">{initials(p.name)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-main truncate">{p.name}</p>
                    <p className="text-[11px] text-text-subtle truncate">
                      {p.role === 'admin' ? t('chat_manager') : p.jobTitle || t('chat_direct')}
                    </p>
                  </div>
                  <ArrowRight size={13} className="text-text-subtle flex-shrink-0" />
                </button>
              ))}
            </Section>
          )}

          {directRooms.length === 0 && taskRooms.length === 0 && startable.length === 0 && (
            <div className="py-10 flex flex-col items-center gap-2 px-4 text-center">
              <MessageSquare size={26} className="text-text-subtle" />
              <p className="text-sm text-text-muted font-medium">{t('chat_noConversations')}</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── The open room ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!active ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <MessageSquare size={40} className="text-text-subtle" />
            <p className="text-text-muted font-medium">{t('chat_pickConversation')}</p>
            <p className="text-text-subtle text-sm">{t('chat_pickConversationDesc')}</p>
          </div>
        ) : (
          <>
            {/* Header. A task room says what it is about, and that label is the
                way back to the task itself. */}
            <div className="px-5 py-3 border-b border-border bg-surface flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-text-main font-semibold text-sm truncate">{titleOf(active)}</p>
                <p className="text-text-subtle text-xs">
                  {active.kind === 'task' ? t('chat_taskThread') : t('chat_direct')}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {active.kind === 'task' && active.taskId && (
                  <button
                    onClick={() => goToTask(active.taskId!)}
                    className="flex items-center gap-1.5 text-xs bg-amber/10 text-amber px-2.5 py-1.5 rounded-lg hover:bg-amber/20 transition-colors font-medium"
                  >
                    <CheckSquare size={13} />
                    {t('chat_openTask')}
                  </button>
                )}
                {active.clusterId && activeProjectId && (
                  <button
                    onClick={() =>
                      navigate(
                        isAdmin
                          ? `/admin/projects/${activeProjectId}/resources`
                          : '/employee/resources'
                      )
                    }
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-main px-2.5 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
                    title={t('chat_openFolder')}
                  >
                    <FolderOpen size={13} />
                    {t('chat_files')}
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
              {roomMessages.length === 0 ? (
                <div className="py-16 flex flex-col items-center gap-2">
                  <MessageSquare size={28} className="text-text-subtle" />
                  <p className="text-sm text-text-muted">{t('chat_noMessages')}</p>
                </div>
              ) : (
                roomMessages.map((m, i) => {
                  const mine = m.authorId === me
                  const prev = roomMessages[i - 1]
                  const newDay =
                    !prev || m.createdAt.slice(0, 10) !== prev.createdAt.slice(0, 10)
                  // Consecutive messages from one person read as one turn.
                  const grouped = !newDay && prev?.authorId === m.authorId

                  return (
                    <div key={m.id}>
                      {newDay && (
                        <div className="flex items-center gap-3 my-4">
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-[10px] text-text-subtle font-medium uppercase tracking-wide">
                            {dayLabel(m.createdAt)}
                          </span>
                          <div className="flex-1 h-px bg-border" />
                        </div>
                      )}
                      <div className={`flex gap-2 ${mine ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-0.5' : 'mt-3'}`}>
                        {!mine && (
                          <div className={`w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 ${grouped ? 'invisible' : ''}`}>
                            <span className="text-white text-[9px] font-bold">
                              {initials(nameOf(m.authorId))}
                            </span>
                          </div>
                        )}
                        <div className={`max-w-[70%] group ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                          {!grouped && (
                            <span className="text-[11px] text-text-subtle mb-0.5 px-1">
                              {mine ? t('chat_you') : nameOf(m.authorId)} · {format(parseISO(m.createdAt), 'HH:mm')}
                            </span>
                          )}
                          <div
                            className={`rounded-2xl px-3.5 py-2 ${
                              mine
                                ? 'bg-primary text-white rounded-br-md'
                                : 'bg-surface border border-border text-text-main rounded-bl-md'
                            }`}
                          >
                            {m.body && (
                              <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                            )}

                            {/* Documents. Real project files, so each one opens
                                and downloads like anything in Resources. */}
                            {m.itemIds.length > 0 && (
                              <div className={`space-y-1 ${m.body ? 'mt-2' : ''}`}>
                                {m.itemIds.map((itemId) => {
                                  const item = items.find((x) => x.id === itemId)
                                  if (!item) {
                                    return (
                                      <p key={itemId} className={`text-xs italic ${mine ? 'text-white/60' : 'text-text-subtle'}`}>
                                        {t('chat_fileGone')}
                                      </p>
                                    )
                                  }
                                  return (
                                    <button
                                      key={itemId}
                                      onClick={() => download(item)}
                                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                                        mine ? 'bg-white/15 hover:bg-white/25' : 'bg-surface-2 hover:bg-border'
                                      }`}
                                    >
                                      <FileKindIcon mime={item.mimeType} fileName={item.fileName} size={15} />
                                      <span className="text-xs truncate flex-1">{item.title}</span>
                                      <span className={`text-[10px] flex-shrink-0 ${mine ? 'text-white/70' : 'text-text-subtle'}`}>
                                        {formatFileSize(item.size)}
                                      </span>
                                      <Download size={11} className="flex-shrink-0" />
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>

                          {(mine || isAdmin) && (
                            <button
                              onClick={() => deleteMessage(m.id, active.id)}
                              className="opacity-0 group-hover:opacity-100 text-text-subtle hover:text-danger transition-all mt-0.5 px-1"
                              title={t('chat_delete')}
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={endRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-border bg-surface px-4 py-3">
              {pendingItems.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {pendingItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-1.5 bg-surface-2 border border-border rounded-lg px-2 py-1">
                      <FileKindIcon mime={item.mimeType} fileName={item.fileName} size={13} />
                      <span className="text-xs text-text-main max-w-[160px] truncate">{item.title}</span>
                      <button
                        onClick={() => setPendingItems((prev) => prev.filter((p) => p.id !== item.id))}
                        className="text-text-subtle hover:text-danger"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title={t('chat_uploadFile')}
                  className="p-2 rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors disabled:opacity-50"
                >
                  <Paperclip size={17} />
                </button>
                <button
                  onClick={() => setPicking(true)}
                  title={t('chat_linkDoc')}
                  className="p-2 rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors"
                >
                  <Link2 size={17} />
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFiles} />

                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('chat_messagePlaceholder')}
                  rows={1}
                  className="flex-1 bg-surface-2 border border-border rounded-xl px-3.5 py-2.5 text-sm text-text-main placeholder-text-subtle resize-none outline-none focus:border-primary max-h-32"
                  onKeyDown={(e) => {
                    // Enter sends, Shift+Enter breaks the line — what every
                    // messaging app does, and what fingers expect here.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || uploading || (!draft.trim() && pendingItems.length === 0)}
                  className="p-2.5 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>
              {uploading && (
                <p className="text-[11px] text-text-subtle mt-1.5 px-1">{t('chat_uploading')}</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Linking a document that is already in Resources. */}
      {picking && activeProjectId && (
        <ResourceLinkPicker
          projectId={activeProjectId}
          title={t('chat_linkDoc')}
          subtitle={t('chat_linkDocDesc')}
          initial={[]}
          onClose={() => setPicking(false)}
          onSave={async (links: LinkKey[]) => {
            const picked = links
              .map((l) => items.find((i) => i.id === l.itemId))
              .filter((i): i is ResourceItem => !!i)
            setPendingItems((prev) => [
              ...prev,
              ...picked.filter((p) => !prev.some((x) => x.id === p.id)),
            ])
            setPicking(false)
          }}
        />
      )}

      {/* Where an upload should be filed. The room's own folder is the default;
          anywhere else is a deliberate choice, so it is offered rather than
          assumed. */}
      {choosingTarget && (
        <UploadTargetDialog
          fileCount={choosingTarget.length}
          projectId={activeProjectId}
          roomLabel={active ? titleOf(active) : ''}
          onCancel={() => setChoosingTarget(null)}
          onChoose={(target) => uploadInto(choosingTarget, target)}
        />
      )}
    </div>
  )
}

/**
 * Picks the cluster an uploaded document is filed into. The room's folder is
 * always one of them — the point of the room folder is that chat files are
 * findable later — and this asks whether it should also live somewhere else.
 */
function UploadTargetDialog({
  fileCount,
  projectId,
  roomLabel,
  onCancel,
  onChoose,
}: {
  fileCount: number
  projectId: string | null
  roomLabel: string
  onCancel: () => void
  onChoose: (target: UploadTarget) => void
}) {
  const { t } = useT()
  const { clusters } = useProjectStore()
  const [query, setQuery] = useState('')

  const options = useMemo(
    () =>
      clusters
        .filter((c) => c.projectId === projectId)
        .filter((c) => !query.trim() || c.title.toLowerCase().includes(query.trim().toLowerCase())),
    [clusters, projectId, query]
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-surface border border-border rounded-xl shadow-lg w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <p className="text-text-main font-semibold text-sm">{t('chat_whereToFile')}</p>
          <p className="text-text-subtle text-xs mt-0.5">
            {t('chat_whereToFileDesc').replace('{n}', String(fileCount))}
          </p>
        </div>

        <div className="p-3 border-b border-border">
          <button
            onClick={() => onChoose({ clusterId: null, label: roomLabel })}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-primary text-white text-left hover:bg-primary/90 transition-colors"
          >
            <MessageSquare size={15} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{t('chat_fileInRoom')}</p>
              <p className="text-[11px] text-white/70 truncate">{roomLabel}</p>
            </div>
          </button>
        </div>

        <div className="px-3 pt-3">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('chat_searchFolders')}
              className="w-full bg-surface-2 border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-text-main placeholder-text-subtle outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {options.length === 0 ? (
            <p className="text-xs text-text-subtle text-center py-6">{t('chat_noFolders')}</p>
          ) : (
            options.map((c) => (
              <button
                key={c.id}
                onClick={() => onChoose({ clusterId: c.id, label: c.title })}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-surface-2 transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                <span className="text-sm text-text-main truncate flex-1">{c.title}</span>
              </button>
            ))
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-end">
          <button
            onClick={onCancel}
            className="text-sm text-text-muted hover:text-text-main px-3 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
          >
            {t('chat_cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
