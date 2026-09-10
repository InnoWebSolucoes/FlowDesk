import React, { useState, useRef, useEffect } from 'react'
import { Globe, FileText, Upload, Trash2, Download, FolderPlus, Folder, ExternalLink, X } from 'lucide-react'
import { useToolStore } from '../../store/toolStore'
import { useAuthStore } from '../../store/authStore'
import { EmptyState } from '../../components/shared/EmptyState'
import { format, parseISO } from 'date-fns'
import { useT } from '../../i18n/useT'
import { Document } from '../../types'
import { Favicon } from '../../components/shared/Favicon'
import { DocumentThumb } from '../../components/shared/DocumentThumb'
import { fileKind } from '../../components/resources/ResourceThumbnail'

const TABS = ['websites', 'documents'] as const
type Tab = typeof TABS[number]

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  // The image being looked at full size, with the signed URL it was opened
  // with — signatures expire, so it is fetched at open rather than reused.
  const [preview, setPreview] = useState<{ url: string; doc: Document } | null>(null)

  // Escape leaves the viewer. Bound only while it is open, so it does not
  // swallow the key from the rename inputs the rest of the time.
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])
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

  /**
   * Looking at a document without committing to downloading it.
   *
   * An image opens in the viewer below, which is the common case here —
   * screenshots of work. Anything else the browser can render itself (a PDF)
   * opens in a tab; anything it cannot falls back to downloading, because
   * pointing a tab at a .docx just downloads it anyway with an extra step.
   */
  const openDoc = async (doc: Document) => {
    const kind = fileKind(doc.type || null, doc.name)
    if (kind === 'image') {
      const url = await getDocumentUrl(doc.storagePath)
      if (url) setPreview({ url, doc })
      return
    }
    if (kind === 'pdf' || kind === 'text') {
      const url = await getDocumentUrl(doc.storagePath)
      if (url) window.open(url, '_blank', 'noopener')
      return
    }
    handleDownload(doc)
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
                {/* Labelled, not just placeheld: three bare boxes in a row
                    got the address typed into the name, which then showed the
                    URL as the title and left the favicon looking for a
                    hostname that was never a hostname. */}
                <label className="block">
                  <span className="text-text-muted text-[11px]">{t('toolbox_websiteUrlLabel')}</span>
                  <input
                    autoFocus
                    type="url"
                    inputMode="url"
                    value={siteUrl}
                    onChange={(e) => setSiteUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addSite() }}
                    placeholder={t('toolbox_websiteUrl')}
                    className="w-full text-sm bg-surface-2 border border-border rounded-lg px-3 py-2 mt-0.5"
                  />
                </label>
                <label className="block">
                  <span className="text-text-muted text-[11px]">{t('toolbox_websiteNameLabel')}</span>
                  <input
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addSite() }}
                    placeholder={t('toolbox_websiteName')}
                    className="w-full text-sm bg-surface-2 border border-border rounded-lg px-3 py-2 mt-0.5"
                  />
                </label>
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
            // Icons with their names under them, the way a desktop or a
            // phone home screen reads: the whole tile is the link, so there
            // is no separate Open button to aim at.
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {myWebsites.map(w => (
                <a
                  key={w.id}
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={w.description || w.url}
                  className="group flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-surface-2 transition-colors"
                >
                  <Favicon
                    url={w.url}
                    name={w.name}
                    className="w-10 h-10 rounded-xl object-contain bg-surface border border-border p-1.5 shadow-sm group-hover:shadow transition-shadow"
                    letterClassName="w-10 h-10 rounded-xl bg-primary-light border border-border shadow-sm flex items-center justify-center text-primary font-semibold"
                  />
                  <span className="text-text-main text-xs text-center leading-tight line-clamp-2 w-full">
                    {w.name}
                  </span>
                </a>
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
              // Cards rather than rows: a list of identical grey glyphs said
              // nothing about which file was which, and an employee looking
              // for the screenshot they uploaded had to read every filename.
              // An image shows itself; everything else shows its type.
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {displayedDocs.map(doc => (
                  <div
                    key={doc.id}
                    className="group bg-surface rounded-xl border border-border p-2.5 flex flex-col gap-2 hover:border-primary/40 transition-colors"
                  >
                    <button
                      onClick={() => openDoc(doc)}
                      title={t('toolbox_openPreview')}
                      className="block w-full"
                    >
                      <DocumentThumb doc={doc} />
                    </button>

                    <div className="min-w-0">
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
                          className="text-sm font-medium text-text-main truncate cursor-text leading-snug"
                          title={doc.name}
                          onClick={() => { setRenamingDoc(doc.id); setTitleDraft(doc.title) }}
                        >
                          {doc.title}
                        </p>
                      )}
                      <p className="text-[11px] text-text-subtle truncate">
                        {formatFileSize(doc.size)} · {format(parseISO(doc.uploadedAt), 'd MMM yyyy', dateLocale)}
                      </p>
                    </div>

                    {/* Always present, not hover-only: on a touch screen there
                        is no hover, and these are the only way to get the file. */}
                    <div className="flex items-center gap-1 border-t border-border pt-2 -mb-0.5">
                      <button onClick={() => handleDownload(doc)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1 rounded-md text-[11px] text-text-muted hover:bg-surface-2 hover:text-primary transition-colors"
                        title={t('toolbox_download')}>
                        <Download size={13} /> {t('toolbox_download')}
                      </button>
                      <button onClick={() => deleteDocument(doc.id)}
                        className="p-1 rounded-md text-text-subtle hover:bg-danger-bg hover:text-danger transition-colors"
                        title={t('toolbox_delete')}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full-size image viewer. Click anywhere or press Escape to leave;
          download is here too, so looking at something and then keeping it
          does not mean finding the card again. */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex items-center gap-3 mb-3 max-w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white text-sm font-medium truncate">{preview.doc.title}</p>
            <button
              onClick={() => handleDownload(preview.doc)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/15 text-white text-xs hover:bg-white/25 transition-colors flex-shrink-0"
            >
              <Download size={13} /> {t('toolbox_download')}
            </button>
            <button
              onClick={() => setPreview(null)}
              className="p-1 rounded-md text-white/80 hover:text-white hover:bg-white/15 transition-colors flex-shrink-0"
              title={t('ui_close')}
            >
              <X size={16} />
            </button>
          </div>
          <img
            src={preview.url}
            alt={preview.doc.title}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  )
}
