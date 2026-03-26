import React from 'react'

interface BadgeProps {
  label: string
  color?: string
  size?: 'sm' | 'md'
}

export function Badge({ label, color = '#6B6960', size = 'md' }: BadgeProps) {
  const padding = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs'
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${padding}`}
      style={{ backgroundColor: color + '20', color: color, border: `1px solid ${color}40` }}
    >
      {label}
    </span>
  )
}
