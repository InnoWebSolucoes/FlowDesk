import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Highlighter,
  Heading1, Heading2, Heading3, List, ListOrdered, ListChecks,
  AlignLeft, AlignCenter, AlignRight, Table as TableIcon, Link2, Quote,
  Code, Minus, Undo2, Redo2, Pencil, Trash2, Type,
} from 'lucide-react'
import { DrawingPad } from './DrawingPad'

/**
 * The extension set. Kept here rather than inline so the editor and any
 * read-only renderer agree on exactly what the stored HTML may contain.
 */
export const noteExtensions = [
  StarterKit,
  Underline,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Link.configure({ openOnClick: false, autolink: true }),
  // Drawings and pasted pictures both land as images.
  Image.configure({ allowBase64: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: 'Start writing…' }),
]

function Btn({
  onClick,
  active,
  title,
  children,
  disabled,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep the selection while clicking
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors disabled:opacity-30 ${
        active ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface-2 hover:text-text-main'
      }`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="w-px h-5 bg-border mx-1 flex-shrink-0" />
}

/** The formatting bar. Everything the iPhone Notes app offers, and tables. */
function Toolbar({ editor, onDraw }: { editor: Editor; onDraw: () => void }) {
  // Subscribing to the editor's transactions is what keeps the active states
  // honest — without it the buttons never light up as the caret moves.
  const [, force] = useState(0)
  useEffect(() => {
    const update = () => force((n) => n + 1)
    editor.on('transaction', update)
    editor.on('selectionUpdate', update)
    return () => {
      editor.off('transaction', update)
      editor.off('selectionUpdate', update)
    }
  }, [editor])

  const addLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', previous ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  return (
    <div className="flex items-center gap-0.5 flex-wrap p-2 border-b border-border bg-surface sticky top-0 z-10">
      <Btn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
        <Undo2 size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
        <Redo2 size={15} />
      </Btn>

      <Divider />

      {/* Text size, as the Notes app's Aa menu does it. */}
      <Btn
        onClick={() => editor.chain().focus().setParagraph().run()}
        active={editor.isActive('paragraph')}
        title="Body text"
      >
        <Type size={15} />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive('heading', { level: 1 })}
        title="Title"
      >
        <Heading1 size={15} />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        title="Heading"
      >
        <Heading2 size={15} />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
        title="Subheading"
      >
        <Heading3 size={15} />
      </Btn>

      <Divider />

      <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
        <Bold size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
        <Italic size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
        <UnderlineIcon size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
        <Strikethrough size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="Highlight">
        <Highlighter size={15} />
      </Btn>

      <Divider />

      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bulleted list">
        <List size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
        <ListOrdered size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Checklist">
        <ListChecks size={15} />
      </Btn>

      <Divider />

      <Btn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
        <AlignLeft size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Centre">
        <AlignCenter size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">
        <AlignRight size={15} />
      </Btn>

      <Divider />

      <Btn
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        active={editor.isActive('table')}
        title="Insert table"
      >
        <TableIcon size={15} />
      </Btn>
      <Btn onClick={onDraw} title="Add a drawing">
        <Pencil size={15} />
      </Btn>
      <Btn onClick={addLink} active={editor.isActive('link')} title="Link">
        <Link2 size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
        <Quote size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code">
        <Code size={15} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">
        <Minus size={15} />
      </Btn>

      {/* Table editing only makes sense with the caret inside one. */}
      {editor.isActive('table') && (
        <>
          <Divider />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().addRowAfter().run()}
            className="px-2 py-1 rounded text-[11px] text-text-muted hover:bg-surface-2"
          >
            + Row
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
            className="px-2 py-1 rounded text-[11px] text-text-muted hover:bg-surface-2"
          >
            + Col
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().deleteRow().run()}
            className="px-2 py-1 rounded text-[11px] text-text-muted hover:bg-surface-2"
          >
            − Row
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().deleteColumn().run()}
            className="px-2 py-1 rounded text-[11px] text-text-muted hover:bg-surface-2"
          >
            − Col
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().deleteTable().run()}
            className="px-2 py-1 rounded text-[11px] text-danger hover:bg-surface-2"
          >
            <Trash2 size={12} />
          </button>
        </>
      )}
    </div>
  )
}

/**
 * A note, open for writing.
 *
 * Autosaves rather than asking you to press Save: a note you have to remember
 * to save is a note you eventually lose. The debounce keeps that from being a
 * write per keystroke.
 */
export function NoteEditor({
  content,
  onChange,
  readOnly = false,
  autofocus = false,
}: {
  content: string
  onChange: (html: string) => void
  readOnly?: boolean
  autofocus?: boolean
}) {
  const [drawing, setDrawing] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor({
    extensions: noteExtensions,
    content,
    editable: !readOnly,
    autofocus: autofocus ? 'end' : false,
    onUpdate: ({ editor: ed }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => onChange(ed.getHTML()), 500)
    },
    editorProps: {
      attributes: {
        class: 'note-prose focus:outline-none min-h-[8rem]',
      },
    },
  })

  // The note can change underneath us — another device, or the board reloading.
  // Only take the incoming value when it really differs, or every keystroke
  // would fight the editor for the caret.
  useEffect(() => {
    if (!editor) return
    if (content !== editor.getHTML()) {
      editor.commands.setContent(content, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  useEffect(() => {
    if (editor) editor.setEditable(!readOnly)
  }, [editor, readOnly])

  // Flush anything still pending when the editor goes away, so closing a note
  // straight after typing does not lose the last few characters.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    []
  )

  const insertDrawing = useCallback(
    (dataUrl: string) => {
      editor?.chain().focus().setImage({ src: dataUrl }).run()
      setDrawing(false)
    },
    [editor]
  )

  if (!editor) return null

  return (
    <div className="flex flex-col h-full min-h-0">
      {!readOnly && <Toolbar editor={editor} onDraw={() => setDrawing(true)} />}
      <div className="flex-1 overflow-y-auto p-4">
        <EditorContent editor={editor} />
      </div>
      {drawing && <DrawingPad onCancel={() => setDrawing(false)} onSave={insertDrawing} />}
    </div>
  )
}
