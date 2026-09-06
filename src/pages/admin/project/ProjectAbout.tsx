import React, { useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { Save, Trash2, Globe, Mail, Phone, MapPin, User, MessageCircle } from 'lucide-react'
import { Project } from '../../../types'
import { useProjectStore } from '../../../store/projectStore'
import { openWhatsapp, normalisePhoneDigits } from '../../../lib/nativeShare'
import { useT } from '../../../i18n/useT'

interface Ctx { project: Project }

export function ProjectAbout() {
  const { project } = useOutletContext<Ctx>()
  // Keyed on the project id so the form re-seeds when switching projects.
  return <ProjectAboutForm key={project.id} project={project} />
}

function ProjectAboutForm({ project }: { project: Project }) {
  const { t } = useT()
  const { updateProject, deleteProject } = useProjectStore()
  const navigate = useNavigate()

  const [form, setForm] = useState(project)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty = JSON.stringify(form) !== JSON.stringify(project)

  const set = <K extends keyof Project>(key: K, value: Project[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSave = async () => {
    setSaving(true)
    await updateProject(project.id, form)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleDelete = async () => {
    await deleteProject(project.id)
    navigate('/admin/projects')
  }

  const field = (
    label: string,
    key: keyof Project,
    opts: {
      placeholder?: string
      type?: string
      icon?: React.ReactNode
      /** Rendered inside the field's right edge, e.g. the WhatsApp shortcut. */
      action?: React.ReactNode
    } = {}
  ) => (
    <div>
      <label className="block text-xs font-medium text-text-muted mb-1.5">{label}</label>
      <div className="relative">
        {opts.icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none">
            {opts.icon}
          </span>
        )}
        <input
          type={opts.type ?? 'text'}
          value={(form[key] as string) ?? ''}
          onChange={(e) => set(key, e.target.value as Project[typeof key])}
          placeholder={opts.placeholder}
          className={`w-full py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary ${
            opts.icon ? 'pl-9' : 'pl-3'
          } ${opts.action ? 'pr-10' : 'pr-3'}`}
        />
        {opts.action && (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{opts.action}</span>
        )}
      </div>
    </div>
  )

  // The number as typed is only a chat link once it has a country code; when it
  // is not usable the button is hidden rather than failing on click.
  const waDigits = normalisePhoneDigits(form.contactPhone)
  const whatsappButton = waDigits ? (
    <button
      type="button"
      onClick={() =>
        openWhatsapp(form.contactPhone, `Olá! Sobre o projeto ${project.name}: `)
      }
      title={`Open WhatsApp chat with +${waDigits}`}
      className="p-1.5 rounded-md text-[#25d366] hover:bg-[#25d366]/15 transition-colors"
    >
      <MessageCircle size={16} />
    </button>
  ) : null

  return (
    <div className="max-w-3xl space-y-6">
      {/* Description */}
      <section className="bg-surface border border-border rounded-xl p-5">
        <h2 className="text-text-main font-semibold text-sm mb-4">{t('proj_projectDescription')}</h2>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field('Project name', 'name')}
            {field('Company name', 'companyName')}
          </div>
          {field('Industry', 'industry', { placeholder: 'e.g. Construction, Hospitality' })}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">{t('proj_fullDescription')}</label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={8}
              placeholder={t('proj_whatThisCompanyDoesTheScope')}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main resize-y focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="bg-surface border border-border rounded-xl p-5">
        <h2 className="text-text-main font-semibold text-sm mb-4">{t('proj_contactDetails')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('Website', 'website', { placeholder: 'https://', icon: <Globe size={14} /> })}
          {field('Contact name', 'contactName', { icon: <User size={14} /> })}
          {field('Contact email', 'contactEmail', { type: 'email', icon: <Mail size={14} /> })}
          {field('Contact phone', 'contactPhone', {
            icon: <Phone size={14} />,
            action: whatsappButton,
          })}
          <div className="sm:col-span-2">
            {field('Address', 'address', { icon: <MapPin size={14} /> })}
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="bg-surface border border-border rounded-xl p-5">
        <h2 className="text-text-main font-semibold text-sm mb-4">{t('ui_colour')}</h2>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={form.color}
            onChange={(e) => set('color', e.target.value)}
            className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-surface-2"
          />
          <span className="text-text-muted text-sm">{t('proj_usedAcrossTheProjectSCards')}</span>
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark disabled:opacity-40 transition-colors"
        >
          <Save size={15} />
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
        </button>
        <button
          onClick={handleDelete}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border text-text-muted text-sm hover:text-danger hover:border-danger transition-colors ml-auto"
        >
          <Trash2 size={15} />{t('proj_deleteProject')}</button>
      </div>
    </div>
  )
}
