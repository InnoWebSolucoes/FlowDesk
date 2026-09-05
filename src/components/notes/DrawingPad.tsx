import React, { useEffect, useRef, useState } from 'react'
import { X, Undo2, Eraser, Check } from 'lucide-react'

const COLOURS = ['#18181b', '#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#9333ea']
const WIDTHS = [2, 4, 8, 16]

type Stroke = { colour: string; width: number; erase: boolean; points: { x: number; y: number }[] }

/**
 * Freehand sketching, as the Notes app's markup does it.
 *
 * Strokes are kept as points rather than painted straight onto the canvas so
 * undo is exact and the drawing survives a resize. The result goes into the
 * note as a PNG data URL, which is why the canvas is drawn on white: a
 * transparent sketch would vanish against a dark background.
 */
export function DrawingPad({
  onSave,
  onCancel,
}: {
  onSave: (dataUrl: string) => void
  onCancel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [colour, setColour] = useState(COLOURS[0])
  const [width, setWidth] = useState(WIDTHS[1])
  const [erasing, setErasing] = useState(false)
  const drawingRef = useRef(false)

  // Repaint from the stroke list. Cheap enough at sketch sizes, and it keeps
  // the canvas and the model from drifting apart.
  const repaint = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue
      ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
      ctx.strokeStyle = stroke.colour
      ctx.lineWidth = stroke.width
      ctx.beginPath()
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      for (const p of stroke.points.slice(1)) ctx.lineTo(p.x, p.y)
      // A single tap is a dot, which a stroke of one point would not draw.
      if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x + 0.1, stroke.points[0].y)
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  useEffect(repaint, [strokes])

  const pointFrom = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent) => {
    drawingRef.current = true
    canvasRef.current?.setPointerCapture(e.pointerId)
    setStrokes((s) => [...s, { colour, width, erase: erasing, points: [pointFrom(e)] }])
  }

  const move = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    const p = pointFrom(e)
    setStrokes((s) => {
      const next = [...s]
      const last = next[next.length - 1]
      if (last) next[next.length - 1] = { ...last, points: [...last.points, p] }
      return next
    })
  }

  const end = () => {
    drawingRef.current = false
  }

  const save = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    onSave(canvas.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-surface rounded-xl border border-border w-full max-w-2xl flex flex-col max-h-[90vh]">
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-text-main font-semibold text-sm">Drawing</span>
          <button onClick={onCancel} className="text-text-subtle hover:text-text-main p-1 rounded">
            <X size={16} />
          </button>
        </header>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-wrap">
          {COLOURS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColour(c)
                setErasing(false)
              }}
              title={c}
              className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                colour === c && !erasing ? 'border-primary scale-110' : 'border-black/15'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}

          <span className="w-px h-5 bg-border mx-1" />

          {WIDTHS.map((w) => (
            <button
              key={w}
              onClick={() => setWidth(w)}
              title={`${w}px`}
              className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                width === w ? 'bg-primary/15' : 'hover:bg-surface-2'
              }`}
            >
              <span
                className="rounded-full bg-text-main block"
                style={{ width: Math.min(w, 14), height: Math.min(w, 14) }}
              />
            </button>
          ))}

          <span className="w-px h-5 bg-border mx-1" />

          <button
            onClick={() => setErasing((v) => !v)}
            title="Eraser"
            className={`p-1.5 rounded transition-colors ${
              erasing ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface-2'
            }`}
          >
            <Eraser size={15} />
          </button>
          <button
            onClick={() => setStrokes((s) => s.slice(0, -1))}
            disabled={strokes.length === 0}
            title="Undo stroke"
            className="p-1.5 rounded text-text-muted hover:bg-surface-2 disabled:opacity-30"
          >
            <Undo2 size={15} />
          </button>
        </div>

        <div className="p-4 overflow-auto">
          <canvas
            ref={canvasRef}
            width={880}
            height={520}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            className="w-full border border-border rounded-lg bg-white touch-none cursor-crosshair"
          />
        </div>

        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-lg border border-border text-text-muted text-sm hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={strokes.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-primary-dark transition-colors"
          >
            <Check size={15} /> Insert
          </button>
        </footer>
      </div>
    </div>
  )
}
