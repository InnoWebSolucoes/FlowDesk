import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, X, Send, Check } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useProjectStore } from '../../store/projectStore'
import { useT } from '../../i18n/useT'

/** One exchange in the visible transcript. */
type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; actions?: { tool: string; summary: string }[] }

interface Question {
  question: string
  options: { label: string; description?: string }[]
  allowMultiple?: boolean
}

/**
 * Renders an assistant reply, turning [label](/p/...) into links that navigate
 * inside the app. The model is told to write project paths as `/p/...`; the
 * real project id is only known here, so it is substituted at render time.
 * Anything that is not one of those paths is left as plain text — a reply
 * should never be able to send someone off-site.
 */
function ReplyText({ text, projectBase, onNavigate }: {
  text: string
  projectBase: string
  onNavigate: (to: string) => void
}) {
  const parts: React.ReactNode[] = []
  const pattern = /\[([^\]]+)\]\((\/p\/[A-Za-z0-9\-_/?=&.]*)\)/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const to = projectBase + m[2].slice('/p'.length)
    parts.push(
      <button
        key={`${m.index}-${m[1]}`}
        onClick={() => onNavigate(to)}
        className="text-primary underline underline-offset-2 hover:text-primary-dark text-left"
      >
        {m[1]}
      </button>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))

  return <>{parts}</>
}

/**
 * The assistant panel. The conversation the model sees (`apiMessages`) is kept
 * separate from what is rendered, because it also carries tool calls and their
 * results, which are noise to a reader.
 */
export function Assistant({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useT()
  const [turns, setTurns] = useState<Turn[]>([])
  const [apiMessages, setApiMessages] = useState<unknown[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState<Question | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const { loadTodos, loadCalendar, initialize: reloadProjects } = useProjectStore()

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, question, busy])

  const send = async (text: string, historyOverride?: unknown[]) => {
    if (!text.trim() || busy) return
    setError('')
    setQuestion(null)
    setPicked([])
    setTurns((t) => [...t, { role: 'user', text }])
    setBusy(true)

    const history = historyOverride ?? apiMessages
    const outgoing = [...history, { role: 'user', content: text }]

    try {
      // The access token expires while a conversation is open, and invoke()
      // sends whatever the client currently holds. getSession() refreshes an
      // expired one first, so a long chat does not die with "Invalid session"
      // partway through.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error(t('err_sessionExpired'))

      const { data, error: fnErr } = await supabase.functions.invoke('assistant', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          projectId,
          messages: outgoing,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })

      // supabase-js discards the response body on a non-2xx and reports only
      // "Edge Function returned a non-2xx status code". The function does say
      // what went wrong, so read it off the response before falling back.
      if (fnErr) {
        const res = (fnErr as { context?: Response }).context
        if (res && typeof res.json === 'function') {
          const errBody = await res.json().catch(() => null)
          if (errBody?.error) throw new Error(errBody.error)
        }
        throw fnErr
      }
      if (data?.error) throw new Error(data.error)

      setApiMessages(data.messages ?? outgoing)
      setTurns((t) => [
        ...t,
        { role: 'assistant', text: data.reply || '', actions: data.actions ?? [] },
      ])
      if (data.question) setQuestion(data.question)

      // Anything the assistant changed needs re-reading, or the app shows stale
      // data next to a message saying it was updated.
      if ((data.actions ?? []).length > 0) {
        loadTodos(projectId)
        loadCalendar(projectId)
        reloadProjects()
      }
    } catch (e) {
      setError((e as Error).message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const submitAnswer = () => {
    if (picked.length === 0) return
    send(picked.join(', '))
  }

  return (
    <aside
      className={
        // A floating window rather than a full-height panel: the assistant is
        // something you consult beside your work, not a place you go. Full
        // screen on a phone, where a window would be unusable.
        'fixed z-50 bg-surface flex flex-col shadow-2xl ' +
        'inset-0 sm:inset-auto sm:bottom-5 sm:right-5 ' +
        'sm:w-[400px] sm:h-[min(620px,calc(100vh-6rem))] ' +
        'sm:rounded-xl sm:border sm:border-border overflow-hidden'
      }
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-primary" />
          <span className="text-text-main font-medium text-sm">{t('ui_assistant')}</span>
        </div>
        <button onClick={onClose} className="text-text-subtle hover:text-text-main p-1 rounded">
          <X size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {turns.length === 0 && (
          <div className="text-center py-8">
            <Sparkles size={22} className="text-primary mx-auto mb-2" />
            <p className="text-text-main text-sm font-medium">{t('ui_askMeAboutThisProject')}</p>
            <p className="text-text-subtle text-xs mt-1 mb-4">{t('ui_iCanSeeYourTodosCalendar')}</p>
            <div className="space-y-1.5 text-left">
              {[
                'When should I do the client contract?',
                'Add "call the supplier" to my todo list',
                'What is not scheduled yet?',
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-surface-2 hover:bg-border text-xs text-text-muted transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={turn.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={
                turn.role === 'user'
                  ? 'max-w-[85%] px-3 py-2 rounded-xl bg-primary text-white text-sm whitespace-pre-wrap'
                  : 'max-w-full text-sm text-text-main whitespace-pre-wrap'
              }
            >
              {turn.role === 'assistant' ? (
                <ReplyText
                  text={turn.text}
                  projectBase={`/admin/projects/${projectId}`}
                  onNavigate={(to) => { navigate(to); onClose() }}
                />
              ) : (
                turn.text
              )}
              {turn.role === 'assistant' && turn.actions && turn.actions.length > 0 && (
                <div className="mt-2 space-y-1">
                  {turn.actions.map((a, j) => (
                    <div
                      key={j}
                      className="flex items-center gap-1.5 text-[11px] text-success bg-success-bg px-2 py-1 rounded-md"
                    >
                      <Check size={11} /> {a.summary}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {question && (
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-sm text-text-main mb-2">{question.question}</p>
            <div className="space-y-1.5">
              {question.options.map((opt) => {
                const active = picked.includes(opt.label)
                return (
                  <button
                    key={opt.label}
                    onClick={() =>
                      setPicked((p) =>
                        question.allowMultiple
                          ? active ? p.filter((x) => x !== opt.label) : [...p, opt.label]
                          : [opt.label],
                      )
                    }
                    className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                      active
                        ? 'border-primary bg-primary-light text-primary'
                        : 'border-border bg-surface text-text-muted hover:bg-surface-2'
                    }`}
                  >
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <span className="block text-[11px] opacity-80 mt-0.5">{opt.description}</span>
                    )}
                  </button>
                )
              })}
            </div>
            <button
              onClick={submitAnswer}
              disabled={picked.length === 0}
              className="mt-2 w-full px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium disabled:opacity-40"
            >{t('ui_sendAnswer')}</button>
          </div>
        )}

        {busy && <p className="text-xs text-text-subtle">{t('ui_thinking')}</p>}
        {error && (
          <p className="text-xs text-danger bg-danger-bg px-3 py-2 rounded-lg">{error}</p>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3 flex-shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                const t = input
                setInput('')
                send(t)
              }
            }}
            placeholder={t('ui_askOrTellMeWhatTo')}
            disabled={busy}
            className="flex-1 px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-main outline-none focus:border-primary disabled:opacity-60"
          />
          <button
            onClick={() => {
              const t = input
              setInput('')
              send(t)
            }}
            disabled={busy || !input.trim()}
            className="px-3 rounded-lg bg-primary text-white disabled:opacity-40"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}

/** Floating button that opens the assistant from anywhere inside a project. */
/**
 * Opens the assistant on a keystroke instead of parking a button over the
 * page. Ctrl+K (Cmd+K on a Mac) is the usual command shortcut, and Escape
 * closes it — the panel has no other way out once the button is gone.
 *
 * A hint appears the first few times so the shortcut is discoverable; it stops
 * showing itself once the assistant has actually been opened.
 */
export function AssistantLauncher({ projectId }: { projectId: string }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(() => {
    try {
      return localStorage.getItem('flowdesk:assistantUsed') === '1'
    } catch {
      return true
    }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        setEverOpened(true)
        try {
          localStorage.setItem('flowdesk:assistantUsed', '1')
        } catch {
          // A blocked store only costs the hint, so carry on.
        }
      }
      // Typing in the assistant's own box should not close it, but Escape
      // anywhere else should.
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      {!open && !everOpened && (
        <div className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border shadow-sm text-xs text-text-muted">
          <Sparkles size={13} className="text-primary" />{t('ui_press')}<kbd className="px-1.5 py-0.5 rounded bg-surface-2 border border-border font-medium">Ctrl</kbd>
          +
          <kbd className="px-1.5 py-0.5 rounded bg-surface-2 border border-border font-medium">K</kbd>
          for the assistant
        </div>
      )}
      {open && <Assistant projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  )
}
