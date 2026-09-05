import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { ChatMessage, Conversation } from '../types'

/** Someone you can message. Everyone, managers included. */
export interface ChatPerson {
  id: string
  name: string
  role: 'admin' | 'employee'
  jobTitle: string
  projectId: string | null
}

interface ChatState {
  conversations: Conversation[]
  /**
   * Everyone in the directory, managers included. The employee store filters
   * to role = 'employee', so it can never name a manager — which left staff
   * with nobody to message and every task room's author unnamed.
   */
  people: ChatPerson[]
  /** Messages of every room that has been opened this session, oldest first. */
  messages: Record<string, ChatMessage[]>
  loading: boolean
  /** Rooms whose messages have been fetched, so reopening one is free. */
  loadedRooms: string[]
  /**
   * What went wrong, for the banner. Chat failing silently is indistinguishable
   * from chat being broken, so every failed write puts its reason here.
   */
  error: string | null
  clearError: () => void

  initialize: (userId: string) => Promise<void>
  teardown: () => void
  /** Load the directory. Cheap, and needed to name anyone in a room. */
  loadPeople: () => Promise<void>

  loadMessages: (conversationId: string) => Promise<void>
  sendMessage: (conversationId: string, body: string, itemIds: string[]) => Promise<void>
  deleteMessage: (messageId: string, conversationId: string) => Promise<void>

  /** The direct room with this person, opening one if it does not exist yet. */
  openDirect: (otherUserId: string) => Promise<Conversation | null>
  /** The room for this task, opening one if it does not exist yet. */
  openTaskRoom: (taskId: string, projectId: string) => Promise<Conversation | null>

  /** The room's folder in Resources, created on demand. */
  ensureCluster: (conversationId: string, title: string) => Promise<string | null>

  markRead: (conversationId: string) => Promise<void>
  unreadCount: (conversationId: string) => number
  totalUnread: () => number
}

function toConversation(row: any): Conversation {
  return {
    id: row.id,
    kind: row.kind,
    projectId: row.project_id ?? null,
    taskId: row.task_id ?? null,
    clusterId: row.cluster_id ?? null,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    memberIds: (row.conversation_members ?? []).map((m: any) => m.user_id),
    lastReadAt: null,
    unread: 0,
  }
}

function toMessage(row: any): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? null,
    itemIds: (row.chat_message_items ?? []).map((i: any) => i.item_id),
  }
}

/** The pair key both sides of a direct chat compute identically. */
function pairKey(a: string, b: string) {
  return [a, b].sort().join(':')
}

/**
 * Live subscription. Kept outside the store because it is a connection, not
 * state, and must survive re-renders.
 */
let channel: ReturnType<typeof supabase.channel> | null = null

/**
 * Whose rooms these are.
 *
 * Read from the Supabase session rather than held in a module variable set by
 * initialize(): the app tears these stores down while auth is still resolving,
 * so a cached id was null exactly when the first messages were being sent —
 * and every write below guards on it, so they returned silently and chat did
 * nothing at all. The session is the one source that is already correct by the
 * time a click can happen.
 */
async function me(): Promise<string | null> {
  // getSession, not getUser: the session is already in memory, so this cannot
  // fail on a slow or dropped connection the way a network round-trip can —
  // and a send must not be lost because the identity lookup timed out.
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id ?? null
}

/**
 * The last known id, for the synchronous paths — the realtime handler and the
 * unread count, which cannot await. Kept in step with the session by
 * initialize(), and only ever an optimisation: nothing that writes relies on it.
 */
let cachedUserId: string | null = null

export const useChatStore = create<ChatState>()((set, get) => ({
  conversations: [],
  people: [],
  messages: {},
  loading: false,
  loadedRooms: [],
  error: null,

  clearError: () => set({ error: null }),

  loadPeople: async () => {
    const { data } = await supabase
      .from('users')
      .select('id, name, role, job_title, project_id')
      .order('name')

    set({
      people: (data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        jobTitle: r.job_title ?? '',
        projectId: r.project_id ?? null,
      })),
    })
  },

  initialize: async (userId) => {
    cachedUserId = userId
    set({ loading: true })

    get().loadPeople()

    // RLS decides what comes back: your direct rooms, and the task rooms for
    // tasks you are on — every task room, for a manager.
    const { data, error } = await supabase
      .from('conversations')
      .select('*, conversation_members(user_id, last_read_at)')
      .order('last_message_at', { ascending: false })

    if (error) {
      console.error('[chat] could not load conversations:', error.message)
      set({ error: error.message, loading: false })
    }

    const conversations = (data ?? []).map((row: any) => {
      const conv = toConversation(row)
      const mine = (row.conversation_members ?? []).find((m: any) => m.user_id === userId)
      return { ...conv, lastReadAt: mine?.last_read_at ?? null }
    })

    set({ conversations, loading: false })

    // The badge cannot be derived from `messages`: that only holds rooms this
    // session has opened, so every unopened room — precisely the ones with
    // something waiting — would report zero. Count them at the source instead.
    await Promise.all(
      conversations.map(async (conv) => {
        const query = supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .neq('author_id', userId)

        const { count } = conv.lastReadAt
          ? await query.gt('created_at', conv.lastReadAt)
          : await query

        if (!count) return
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conv.id ? { ...c, unread: count } : c
          ),
        }))
      })
    )

    if (channel) return
    channel = supabase
      .channel('chat-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        async (payload) => {
          const row: any = payload.new
          // The insert this client made itself already went into state through
          // sendMessage, so drop the echo rather than showing it twice.
          if (get().messages[row.conversation_id]?.some((m) => m.id === row.id)) return

          // A message can be the first sign of a room that did not exist when
          // this client loaded — someone starting a chat with you.
          if (!get().conversations.some((c) => c.id === row.conversation_id)) {
            const uid = cachedUserId ?? (await me())
            if (uid) await get().initialize(uid)
          }

          // Documents arrive as their own rows, so the payload alone cannot say
          // whether the message carries any.
          const { data: full } = await supabase
            .from('chat_messages')
            .select('*, chat_message_items(item_id)')
            .eq('id', row.id)
            .single()

          const message = toMessage(full ?? row)
          set((s) => {
            // Checked again here, not only above: the fetch between the two is
            // an await, and sendMessage may have added this very message in the
            // meantime. Deciding inside the update is the only point at which
            // the answer cannot already be stale.
            const existing = s.messages[message.conversationId] ?? []
            if (existing.some((m) => m.id === message.id)) return s
            return {
              messages: {
                ...s.messages,
                [message.conversationId]: [...existing, message],
              },
              conversations: s.conversations
                .map((c) =>
                  c.id === message.conversationId
                    ? {
                        ...c,
                        lastMessageAt: message.createdAt,
                        // Your own message is not news to you; markRead clears
                        // the count again the moment the room is on screen.
                        unread:
                          message.authorId === cachedUserId ? c.unread : (c.unread ?? 0) + 1,
                      }
                    : c
                )
                .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
            }
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const id = (payload.old as any)?.id
          if (!id) return
          set((s) => {
            const next: Record<string, ChatMessage[]> = {}
            for (const room of Object.keys(s.messages)) {
              next[room] = s.messages[room].filter((m) => m.id !== id)
            }
            return { messages: next }
          })
        }
      )
      .subscribe()
  },

  teardown: () => {
    cachedUserId = null
    set({ conversations: [], people: [], messages: {}, loadedRooms: [], error: null })
    if (!channel) return
    supabase.removeChannel(channel)
    channel = null
  },

  loadMessages: async (conversationId) => {
    const { data } = await supabase
      .from('chat_messages')
      .select('*, chat_message_items(item_id)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    set((s) => ({
      messages: { ...s.messages, [conversationId]: (data ?? []).map(toMessage) },
      loadedRooms: s.loadedRooms.includes(conversationId)
        ? s.loadedRooms
        : [...s.loadedRooms, conversationId],
    }))
  },

  sendMessage: async (conversationId, body, itemIds) => {
    if (!body.trim() && itemIds.length === 0) return
    const userId = await me()
    if (!userId) return

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ conversation_id: conversationId, author_id: userId, body: body.trim() })
      .select()
      .single()

    if (error || !data) {
      // Silence here is the worst outcome: the composer clears and the message
      // is simply gone. Surface it so a policy or connection problem is
      // visible rather than looking like the app ignoring you.
      console.error('[chat] send failed:', error?.message ?? 'no row returned')
      set({ error: error?.message ?? 'Message could not be sent.' })
      return
    }

    if (itemIds.length > 0) {
      await supabase
        .from('chat_message_items')
        .insert(itemIds.map((itemId) => ({ message_id: data.id, item_id: itemId })))
    }

    const message: ChatMessage = { ...toMessage(data), itemIds }
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: [...(s.messages[conversationId] ?? []), message],
      },
      conversations: s.conversations
        .map((c) => (c.id === conversationId ? { ...c, lastMessageAt: message.createdAt } : c))
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    }))

    // Sending is reading: your own message must not leave the room unread.
    await get().markRead(conversationId)
  },

  deleteMessage: async (messageId, conversationId) => {
    await supabase.from('chat_messages').delete().eq('id', messageId)
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] ?? []).filter((m) => m.id !== messageId),
      },
    }))
  },

  openDirect: async (otherUserId) => {
    const userId = await me()
    if (!userId) return null
    const key = pairKey(userId, otherUserId)

    const existing = get().conversations.find(
      (c) => c.kind === 'direct' && c.memberIds.includes(otherUserId)
    )
    if (existing) return existing

    const { data, error } = await supabase
      .from('conversations')
      .insert({ kind: 'direct', pair_key: key, created_by: userId })
      .select()
      .single()

    // The unique index on pair_key means the other person having created the
    // same room a moment earlier is a conflict, not a failure: read theirs.
    if (error || !data) {
      const { data: theirs } = await supabase
        .from('conversations')
        .select('*, conversation_members(user_id, last_read_at)')
        .eq('pair_key', key)
        .maybeSingle()
      if (!theirs) {
        console.error('[chat] could not open a direct chat:', error?.message)
        set({ error: error?.message ?? 'Could not open that chat.' })
        return null
      }
      const conv = toConversation(theirs)
      set((s) => ({ conversations: [conv, ...s.conversations.filter((c) => c.id !== conv.id)] }))
      return conv
    }

    await supabase.from('conversation_members').insert([
      { conversation_id: data.id, user_id: userId },
      { conversation_id: data.id, user_id: otherUserId },
    ])

    const conv: Conversation = {
      ...toConversation(data),
      memberIds: [userId, otherUserId],
    }
    set((s) => ({ conversations: [conv, ...s.conversations] }))
    return conv
  },

  openTaskRoom: async (taskId, projectId) => {
    const userId = await me()
    if (!userId) return null

    const existing = get().conversations.find((c) => c.taskId === taskId)
    if (existing) return existing

    // It may exist without this client having seen it — a manager has rooms
    // for tasks they have never messaged in.
    const { data: found } = await supabase
      .from('conversations')
      .select('*, conversation_members(user_id, last_read_at)')
      .eq('task_id', taskId)
      .maybeSingle()

    if (found) {
      const conv = toConversation(found)
      set((s) => ({ conversations: [conv, ...s.conversations.filter((c) => c.id !== conv.id)] }))
      return conv
    }

    const { data, error } = await supabase
      .from('conversations')
      .insert({ kind: 'task', task_id: taskId, project_id: projectId, created_by: userId })
      .select()
      .single()

    if (error || !data) {
      // Same race as a direct room: the unique index rejected a duplicate.
      const { data: theirs } = await supabase
        .from('conversations')
        .select('*, conversation_members(user_id, last_read_at)')
        .eq('task_id', taskId)
        .maybeSingle()
      if (!theirs) {
        console.error('[chat] could not open the task room:', error?.message)
        set({ error: error?.message ?? 'Could not open that discussion.' })
        return null
      }
      const conv = toConversation(theirs)
      set((s) => ({ conversations: [conv, ...s.conversations.filter((c) => c.id !== conv.id)] }))
      return conv
    }

    const conv = toConversation(data)
    set((s) => ({ conversations: [conv, ...s.conversations] }))
    return conv
  },

  ensureCluster: async (conversationId, title) => {
    const conv = get().conversations.find((c) => c.id === conversationId)
    if (conv?.clusterId) return conv.clusterId

    // Clusters are admin-only to write, so the room's folder is made by a
    // definer function that checks membership rather than the caller's role.
    const { data, error } = await supabase.rpc('ensure_conversation_cluster', {
      conv: conversationId,
      folder_title: title,
    })

    if (error || !data) {
      console.error('[chat] could not create the room folder:', error?.message)
      set({ error: 'Could not file the document in this chat’s folder.' })
      return null
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, clusterId: data as string } : c
      ),
    }))
    return data as string
  },

  markRead: async (conversationId) => {
    const userId = await me()
    if (!userId) return
    const now = new Date().toISOString()

    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, lastReadAt: now, unread: 0 } : c
      ),
    }))

    // A task room has no member rows of its own — its audience is derived — so
    // the marker is written on demand the first time you read one.
    await supabase
      .from('conversation_members')
      .upsert(
        { conversation_id: conversationId, user_id: userId, last_read_at: now },
        { onConflict: 'conversation_id,user_id' }
      )
  },

  unreadCount: (conversationId) =>
    get().conversations.find((c) => c.id === conversationId)?.unread ?? 0,

  totalUnread: () => get().conversations.reduce((sum, c) => sum + get().unreadCount(c.id), 0),
}))
