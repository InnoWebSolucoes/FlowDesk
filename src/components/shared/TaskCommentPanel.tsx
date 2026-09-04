import React, { useState, useRef } from 'react'
import { Paperclip, Send, ChevronDown, ChevronRight, Download, Trash2 } from 'lucide-react'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { useAuthStore } from '../../store/authStore'
import { supabase } from '../../lib/supabaseClient'
import { TaskAttachment } from '../../types'
import { format, parseISO } from 'date-fns'
import { useT } from '../../i18n/useT'
import { v4 as uuidv4 } from 'uuid'

interface TaskCommentPanelProps {
  taskId: string
  currentUserId: string
  currentUserName: string
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function initials(name: string) {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function TaskCommentPanel({ taskId, currentUserId, currentUserName }: TaskCommentPanelProps) {
  const { t } = useT()
  const { getTaskComments, addComment, deleteComment, getActivityLogs } = useTaskStore()
  const { employees } = useEmployeeStore()
  const { currentUser } = useAuthStore()

  const [commentText, setCommentText] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<TaskAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const comments = getTaskComments(taskId)
  const activityLogs = getActivityLogs(taskId)

  const getAuthorName = (authorId: string) => {
    if (authorId === currentUser?.id) return currentUserName
    const emp = employees.find(e => e.id === authorId)
    return emp?.name ?? authorId
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (fileInputRef.current) fileInputRef.current.value = ''

    setUploading(true)
    for (const file of files) {
      const attachmentId = uuidv4()
      const path = `task-attachments/${taskId}/${attachmentId}-${file.name}`
      const { error } = await supabase.storage.from('attachments').upload(path, file)
      if (error) continue

      const attachment: TaskAttachment = {
        id: attachmentId,
        name: file.name,
        type: file.type,
        size: file.size,
        storagePath: path,
        uploadedAt: new Date().toISOString(),
        uploadedBy: currentUserId,
      }
      setPendingAttachments(prev => [...prev, attachment])
    }
    setUploading(false)
  }

  const handleSubmit = async () => {
    if (!commentText.trim() && pendingAttachments.length === 0) return
    setSubmitting(true)
    try {
      await addComment({
        taskId,
        authorId: currentUserId,
        content: commentText.trim(),
        attachments: pendingAttachments,
      })
      setCommentText('')
      setPendingAttachments([])
    } finally {
      setSubmitting(false)
    }
  }

  const handleDownload = async (attachment: TaskAttachment) => {
    const { data, error } = await supabase.storage
      .from('attachments')
      .createSignedUrl(attachment.storagePath, 60)
    if (error || !data) return
    const a = document.createElement('a')
    a.href = data.signedUrl
    a.download = attachment.name
    a.click()
  }

  const handleDelete = async (commentId: string) => {
    if (window.confirm(t('comment_deleteConfirm'))) {
      await deleteComment(commentId)
    }
  }

  const activityLabel = (action: string) => {
    switch (action) {
      case 'completed': return t('activity_completed')
      case 'uncompleted': return t('activity_uncompleted')
      case 'in_progress': return t('activity_inProgress')
      case 'commented': return t('activity_commented')
      case 'file_uploaded': return t('activity_fileUploaded')
      default: return action
    }
  }

  return (
    <div className="border-t border-border mt-2 pt-3 space-y-3">
      {/* Activity Log (collapsible) */}
      <div>
        <button
          onClick={() => setActivityOpen(o => !o)}
          className="flex items-center gap-1.5 text-text-subtle text-xs font-medium hover:text-text-main transition-colors mb-1"
        >
          {activityOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t('activity_title')} ({activityLogs.length})
        </button>
        {activityOpen && (
          <div className="space-y-1.5 pl-3 border-l-2 border-border ml-1">
            {activityLogs.length === 0 ? (
              <p className="text-xs text-text-subtle">{t('activity_noActivity')}</p>
            ) : (
              [...activityLogs].reverse().map(log => (
                <div key={log.id} className="flex items-start gap-2">
                  <div className="w-4 h-4 rounded-full bg-surface-2 border border-border flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="text-xs text-text-main font-medium">{getAuthorName(log.actorId)}</span>
                    <span className="text-xs text-text-muted"> {activityLabel(log.action)}</span>
                    {log.detail && (
                      <span className="text-xs text-text-subtle">, {log.detail}</span>
                    )}
                    <p className="text-[10px] text-text-subtle">
                      {format(parseISO(log.timestamp), 'dd MMM HH:mm')}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Comments list */}
      <div>
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{t('comment_title')} ({comments.length})</p>
        {comments.length === 0 ? (
          <p className="text-xs text-text-subtle">{t('comment_noComments')}</p>
        ) : (
          <div className="space-y-3">
            {comments.map(comment => {
              const authorName = getAuthorName(comment.authorId)
              const isOwn = comment.authorId === currentUserId
              return (
                <div key={comment.id} className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary flex-shrink-0 flex items-center justify-center">
                    <span className="text-white text-[9px] font-bold">{initials(authorName)}</span>
                  </div>
                  <div className="flex-1 min-w-0 bg-surface-2 rounded-lg p-2">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-text-main">{authorName}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-text-subtle">
                          {format(parseISO(comment.createdAt), 'dd MMM HH:mm')}
                        </span>
                        {isOwn && (
                          <button
                            onClick={() => handleDelete(comment.id)}
                            className="text-text-subtle hover:text-danger transition-colors"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    {comment.content && (
                      <p className="text-xs text-text-main whitespace-pre-wrap">{comment.content}</p>
                    )}
                    {comment.attachments.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {comment.attachments.map(att => (
                          <div key={att.id} className="flex items-center gap-2 bg-surface rounded p-1.5">
                            <Paperclip size={11} className="text-text-subtle flex-shrink-0" />
                            <span className="text-xs text-text-main truncate flex-1">{att.name}</span>
                            <span className="text-[10px] text-text-subtle flex-shrink-0">{formatBytes(att.size)}</span>
                            <button
                              onClick={() => handleDownload(att)}
                              className="flex items-center gap-0.5 text-[10px] text-primary hover:underline flex-shrink-0"
                            >
                              <Download size={10} />
                              {t('comment_download')}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add comment form */}
      <div className="space-y-2">
        {pendingAttachments.length > 0 && (
          <div className="space-y-1">
            {pendingAttachments.map(att => (
              <div key={att.id} className="flex items-center gap-2 bg-surface-2 rounded p-1.5">
                <Paperclip size={11} className="text-text-subtle flex-shrink-0" />
                <span className="text-xs text-text-main truncate flex-1">{att.name}</span>
                <span className="text-[10px] text-text-subtle">{formatBytes(att.size)}</span>
                <button
                  onClick={() => setPendingAttachments(prev => prev.filter(a => a.id !== att.id))}
                  className="text-text-subtle hover:text-danger"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={commentText}
          onChange={e => setCommentText(e.target.value)}
          placeholder={t('comment_placeholder')}
          rows={2}
          className="w-full text-xs bg-surface-2 border border-border rounded-lg px-3 py-2 text-text-main placeholder-text-subtle resize-none focus:outline-none focus:border-primary"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit()
          }}
        />
        <div className="flex items-center justify-between">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-main transition-colors"
          >
            <Paperclip size={13} />
            {t('comment_attachFile')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={handleSubmit}
            disabled={submitting || uploading || (!commentText.trim() && pendingAttachments.length === 0)}
            className="flex items-center gap-1.5 text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={11} />
            {t('comment_submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
