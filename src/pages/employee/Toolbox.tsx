import React, { useState, useRef } from 'react'
import { Globe, FileText, Upload, Trash2, Download, FolderPlus, Folder, ExternalLink } from 'lucide-react'
import { useToolStore } from '../../store/toolStore'
import { useAuthStore } from '../../store/authStore'
import { EmptyState } from '../../components/shared/EmptyState'
import { format, parseISO } from 'date-fns'
import { useT } from '../../i18n/useT'
import { Document } from '../../types'

const TABS = ['websites', 'documents'] as const
type Tab = typeof TABS[number]

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(type: string): string {
  if (type.includes('pdf')) return '📄'
  if (type.includes('word') || type.includes('docx') || type.includes('doc')) return '📝'
  if (type.includes('excel') || type.includes('xlsx') || type.includes('spreadsheet')) return '📊'
  if (type.includes('image') || type.includes('png') || type.includes('jpg')) return '🖼️'
  return '📁'
}

export function Toolbox() {
  const { currentUser } = useAuthStore()
  const { websites, documents, folders, uploadDocument, deleteDocument, updateDocument, addWebsite, createFolder, deleteFolder, getDocumentUrl } = useToolStore()
  const { t, dateLocale } = useT()

  const [tab, setTab] = useState<Tab>('websites')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Renaming a document in place: click the title, type, Enter or blur.
  const [renamingDoc, setRenamingDoc] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')

  // Adding a website to your own list.
  const [addingSite, setAddingSite] = useState(false)
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [siteDesc, setSiteDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const empId = currentUser!.id
  const myWebsites = websites.filter(w => w.assignedTo.includes(empId))
  const myDocs = documents.filter(d => d.uploadedBy === empId)
  const myFolders = folders.filter(f => f.ownerId === empId)

  const displayedDocs = selectedFolder === null
    ? myDocs
    : myDocs.filter(d => d.folderId === selectedFolder)

  const saveTitle = async (id: string) => {
    const next = titleDraft.trim()
    setRenamingDoc(null)
    const doc = documents.find((d) => d.id === id)
    // An empty title would leave the row with nothing to show, so it falls
    // back to the filename rather than being accepted.
    if (!doc || next === doc.title) return
    try {
      await updateDocument(id, { title: next || doc.name })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const addSite = async () => {
    const url = siteUrl.trim()
    if (!url) return
    // A bare domain is what people type; without a scheme the link opens
    // relative to the app and goes nowhere.
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    setSaving(true)
    setError('')
    try {
      await addWebsite({
        name: siteName.trim() || new URL(href).hostname.replace(/^www\./, ''),
        url: href,
        description: siteDesc.trim(),
        assignedTo: [empId],
      })
      setSiteName(''); setSiteUrl(''); setSiteDesc(''); setAddingSite(false)
    } catch (err) {
      setError((err as Error).message || 'That could not be added.')
    } finally {
      setSaving(false)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setUploading(true)
    for (const file of Array.from(files)) {
      await uploadDocument(empId, file, selectedFolder ?? undefined)
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    setUploading(true)
    for (const file of files) {
      await uploadDocument(empId, file, selectedFolder ?? undefined)
    }
    setUploading(false)
  }

  const handleDownload = async (doc: Document) => {
    const url = await getDocumentUrl(doc.storagePath)
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = doc.name
    a.click()
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    await createFolder(newFolderName.trim(), empId)
    setNewFolderName('')
    setShowFolderInput(false)
  }

  const tabCls = (tab_: Tab) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      tab === tab_ ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-main'
    }`

  return (
    <div className="animate-fade-in">
      <div className="border-b border-border flex gap-0 mb-6">
        {TABS.map(tab_ => (
          <button key={tab_} onClick={() => setTab(tab_)} className={tabCls(tab_)}>
            {tab_ === 'websites' ? t('toolbox_websites') : t('toolbox_documents')}
          </button>
        ))}
      </div>

      {tab === 'websites' && (
        <div>
          {error && (
            <div className="mb-3 text-sm text-danger bg-danger-bg border border-danger/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Adding a site puts it on your own list and nobody else's. */}
          <div className="mb-4">
            {!addingSite ? (
              <button
                onClick={() => setAddingSite(true)}
                className="inline-flex items-center gap-1.5 text-sm font-medium bg-primary text-white px-3 py-2 rounded-lg hover:bg-primary-dark transition-colors"
              >
                <Globe size={14} /> {t('toolbox_addWebsite')}
              </button>
            ) : (
              <div className="bg-surface rounded-xl border border-border p-4 space-y-2">
                <input
                  autoFocus
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addSite() }}
                  placeholder={t('toolbox_websiteUrl')}
                  className="w-full text-sm bg-surface-2 border border-border rounded-lg px-3 py-2"
                />
                <input
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addSite() }}
                  placeholder={t('toolbox_websiteName')}
                  className="w-full text-sm bg-surface-2 border border-border rounded-lg px-3 py-2"
                />
                <input
                  value={siteDesc}
                  onChange={(e) => setSiteDesc(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addSite() }}
                  placeholder={t('toolbox_websiteDesc')}
                  className="w-full text-sm bg-surface-2 border border-border rounded-lg px-3 py-2"
                />
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={addSite}
                    disabled={saving || !siteUrl.trim()}
                    className="text-sm font-medium bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
                  >
                    {t('toolbox_add')}
                  </button>
                  <button
                    onClick={() => { setAddingSite(false); setError('') }}
                    className="text-sm text-text-muted px-3 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
                  >
                    {t('ui_cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {myWebsites.length === 0 ? (
            <EmptyState
              icon={Globe}
              title={t('toolbox_noWebsites')}
              description={t('toolbox_noWebsitesDesc')}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {myWebsites.map(w => (
                <div key={w.id} className="bg-surface rounded-xl border border-border p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${w.url}&sz=32`}
                      alt=""
                      className="w-8 h-8 rounded-lg flex-shrink-0 object-contain bg-surface-2 p-1"
                      onError={e => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><circle cx=%2212%22 cy=%2212%22 r=%2210%22 fill=%22%23E3F0E9%22/></svg>' }}
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-text-main font-semibold text-sm">{w.name}</h3>
                      <p className="text-text-muted text-xs mt-0.5 line-clamp-2">{w.description}</p>
                    </div>
                  </div>
                  <a
                    href={w.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-1.5 bg-primary text-white text-sm font-medium py-2 rounded-lg hover:bg-primary-dark transition-colors"
                  >
                    <ExternalLink size={13} /> {t('toolbox_open')}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'documents' && (
        <div className="flex gap-5">
          <div className="w-44 flex-shrink-0">
            <div className="space-y-0.5">
              <button
                onClick={() => setSelectedFolder(null)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedFolder === null ? 'bg-primary-light text-primary font-medium' : 'text-text-muted hover:bg-surface-2'
                }`}
              >
                <FileText size={14} />
                {t('toolbox_allFiles')}
                <span className="ml-auto text-xs">{myDocs.length}</span>
              </button>
              {myFolders.map(f => (
                <div key={f.id} className="flex items-center group">
                  <button
                    onClick={() => setSelectedFolder(f.id)}
                    className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedFolder === f.id ? 'bg-primary-light text-primary font-medium' : 'text-text-muted hover:bg-surface-2'
                    }`}
                  >
                    <Folder size={14} />
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto text-xs">{myDocs.filter(d => d.folderId === f.id).length}</span>
                  </button>
                  <button
                    onClick={() => { if (selectedFolder === f.id) setSelectedFolder(null); deleteFolder(f.id) }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-text-subtle hover:text-danger transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3">
              {showFolderInput ? (
                <div className="flex flex-col gap-1.5">
                  <input
                    className="w-full border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-primary"
                    placeholder={t('toolbox_folderName')}
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                    autoFocus
                  />
                  <div className="flex gap-1">
                    <button onClick={handleCreateFolder} className="flex-1 bg-primary text-white text-xs py-1 rounded-lg">{t('toolbox_create')}</button>
                    <button onClick={() => setShowFolderInput(false)} className="px-2 border border-border rounded-lg text-xs text-text-muted">✕</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowFolderInput(true)}
                  className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-main transition-colors px-1"
                >
                  <FolderPlus size={13} /> {t('toolbox_newFolder')}
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 text-center mb-4 cursor-pointer hover:border-primary/50 hover:bg-primary-light/20 transition-all"
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.xls"
                className="hidden"
                onChange={handleUpload}
              />
              <Upload size={20} className="text-text-subtle mx-auto mb-2" />
              <p className="text-text-muted text-sm font-medium">
                {uploading ? t('toolbox_uploading') : t('toolbox_dropFiles')}
              </p>
              <p className="text-text-subtle text-xs mt-1">{t('toolbox_fileTypes')}</p>
            </div>

            {displayedDocs.length === 0 ? (
              <EmptyState icon={FileText} title={t('toolbox_noDocuments')} description={t('toolbox_noDocumentsDesc')} />
            ) : (
              <div className="space-y-2">
                {displayedDocs.map(doc => (
                  <div key={doc.id} className="bg-surface rounded-lg border border-border px-4 py-3 flex items-center gap-3">
                    {/* The site's own favicon where the document is a link,
                        the file-type glyph otherwise. */}
                    {doc.iconUrl ? (
                      <img
                        src={doc.iconUrl}
                        alt=""
                        className="w-6 h-6 rounded flex-shrink-0 object-contain bg-surface-2 p-0.5"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <span className="text-xl flex-shrink-0">{fileIcon(doc.type)}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      {renamingDoc === doc.id ? (
                        <input
                          autoFocus
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          onBlur={() => saveTitle(doc.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveTitle(doc.id)
                            if (e.key === 'Escape') setRenamingDoc(null)
                          }}
                          className="w-full text-sm font-medium text-text-main bg-surface-2 border border-border rounded px-1.5 py-0.5"
                        />
                      ) : (
                        <p
                          className="text-sm font-medium text-text-main truncate cursor-text"
                          title={doc.name}
                          onClick={() => { setRenamingDoc(doc.id); setTitleDraft(doc.title) }}
                        >
                          {doc.title}
                        </p>
                      )}
                      <p className="text-xs text-text-subtle">
                        {formatFileSize(doc.size)} · {format(parseISO(doc.uploadedAt), 'EEE d MMM yyyy', dateLocale)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => handleDownload(doc)}
                        className="p-1.5 rounded hover:bg-surface-2 text-text-subtle hover:text-primary transition-colors"
                        title={t('toolbox_download')}>
                        <Download size={14} />
                      </button>
                      <button onClick={() => deleteDocument(doc.id)}
                        className="p-1.5 rounded hover:bg-danger-bg text-text-subtle hover:text-danger transition-colors"
                        title={t('toolbox_delete')}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
