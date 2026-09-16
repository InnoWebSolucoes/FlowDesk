import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export interface SelectOption<V extends string = string> {
  value: V
  label: string
  /** A swatch beside the label, for categories and the like. */
  color?: string
}

/**
 * A dropdown that opens in the flow of the page rather than over it.
 *
 * The native select floats its options over whatever is underneath, which on
 * a form means the fields below it vanish behind the list. This one grows
 * downward inside the layout, so what is below slides out of the way and
 * comes back when it closes, and it looks like the rest of the form instead
 * of whatever the operating system draws.
 */
export function Select<V extends string = string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className = '',
  size = 'md',
}: {
  value: V
  onChange: (value: V) => void
  options: SelectOption<V>[]
  placeholder?: string
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Clicking anywhere else, or Escape, closes it.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.value === value)
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'

  return (
    <div ref={rootRef} className={`w-full ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border bg-surface text-left transition-colors disabled:opacity-60 disabled:cursor-default ${pad} ${
          open ? 'border-primary ring-1 ring-primary/20' : 'border-border hover:border-border-md'
        } ${current ? 'text-text-main' : 'text-text-muted'}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {current?.color && (
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: current.color }} />
          )}
          <span className="truncate">{current?.label ?? placeholder ?? ''}</span>
        </span>
        <ChevronDown
          size={size === 'sm' ? 13 : 15}
          className={`flex-shrink-0 text-text-subtle transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* In flow, not floating: the grid below animates open so the fields
          under it move down rather than get covered. */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <ul
            role="listbox"
            className="mt-1 py-1 rounded-lg border border-border bg-surface shadow-sm max-h-64 overflow-y-auto"
          >
            {options.map((o) => {
              const selected = o.value === value
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => { onChange(o.value); setOpen(false) }}
                    className={`w-full flex items-center gap-2 text-left transition-colors ${pad} ${
                      selected ? 'bg-primary-light text-primary font-medium' : 'text-text-main hover:bg-surface-2'
                    }`}
                  >
                    {o.color && (
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: o.color }} />
                    )}
                    <span className="flex-1 truncate">{o.label}</span>
                    {selected && <Check size={13} className="flex-shrink-0" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
