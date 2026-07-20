import * as React from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import {
  Bold,
  Code2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  SubscriptIcon,
  SuperscriptIcon,
  Undo2,
} from 'lucide-react'

import { Button } from '#/components/ui'
import { RichTextContent } from '#/lib/blocks/rich-text'
import type { RichTextDocument, RichTextPayload } from '#/lib/blocks/rich-text'
import { cn } from '#/lib/utils'

const extensions = [
  StarterKit.configure({
    blockquote: false,
    codeBlock: false,
    hardBreak: false,
    heading: false,
    horizontalRule: false,
    link: false,
    strike: false,
  }),
  Link.configure({
    openOnClick: false,
    defaultProtocol: 'https',
    HTMLAttributes: { class: null, rel: null, target: null },
  }),
  Subscript,
  Superscript,
]

interface RichTextEditorProps {
  payload: RichTextPayload
  onChange: (payload: RichTextPayload) => void
  onBlur: () => void
  autoFocus?: boolean
  className?: string
}

export function RichTextEditor({
  payload,
  onChange,
  onBlur,
  autoFocus,
  className,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions,
    content: payload.doc,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': 'Text content',
        'aria-multiline': 'true',
        role: 'textbox',
        class:
          'min-h-28 px-3 py-2 text-sm leading-6 outline-none [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p]:min-h-[1.5rem] [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange({ doc: currentEditor.getJSON() as RichTextDocument })
    },
    onBlur,
  })

  const serializedPayload = JSON.stringify(payload.doc)
  React.useEffect(() => {
    if (!editor || JSON.stringify(editor.getJSON()) === serializedPayload)
      return
    editor.commands.setContent(payload.doc, { emitUpdate: false })
  }, [editor, payload.doc, serializedPayload])

  React.useEffect(() => {
    if (editor && autoFocus) editor.commands.focus('end')
  }, [autoFocus, editor])

  if (!editor) {
    return (
      <div
        className={cn(
          'rounded-md border border-input bg-background px-3 py-2',
          className,
        )}
      >
        <RichTextContent payload={payload} />
      </div>
    )
  }

  function setLink() {
    if (!editor) return
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run()
      return
    }
    const href = window.prompt('Link URL', 'https://')
    if (href) editor.chain().focus().setLink({ href }).run()
  }

  const controls = [
    {
      label: 'Bold',
      icon: Bold,
      active: editor.isActive('bold'),
      action: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      icon: Italic,
      active: editor.isActive('italic'),
      action: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Link',
      icon: Link2,
      active: editor.isActive('link'),
      action: setLink,
    },
    {
      label: 'Subscript',
      icon: SubscriptIcon,
      active: editor.isActive('subscript'),
      action: () => editor.chain().focus().toggleSubscript().run(),
    },
    {
      label: 'Superscript',
      icon: SuperscriptIcon,
      active: editor.isActive('superscript'),
      action: () => editor.chain().focus().toggleSuperscript().run(),
    },
    {
      label: 'Inline code',
      icon: Code2,
      active: editor.isActive('code'),
      action: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: 'Bullet list',
      icon: List,
      active: editor.isActive('bulletList'),
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Ordered list',
      icon: ListOrdered,
      active: editor.isActive('orderedList'),
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Undo',
      icon: Undo2,
      active: false,
      action: () => editor.chain().focus().undo().run(),
      disabled: !editor.can().undo(),
    },
    {
      label: 'Redo',
      icon: Redo2,
      active: false,
      action: () => editor.chain().focus().redo().run(),
      disabled: !editor.can().redo(),
    },
  ]

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30',
        className,
      )}
    >
      <div
        aria-label="Text formatting"
        className="flex flex-wrap items-center gap-0.5 border-b bg-muted/35 p-1"
        role="toolbar"
      >
        {controls.map(({ label, icon: Icon, active, action, disabled }) => (
          <Button
            key={label}
            aria-label={label}
            aria-pressed={active || undefined}
            className={cn(
              'size-7 text-muted-foreground shadow-none',
              active && 'bg-accent text-accent-foreground',
            )}
            disabled={disabled}
            onClick={action}
            onMouseDown={(event) => event.preventDefault()}
            size="icon-sm"
            title={label}
            type="button"
            variant="ghost"
          >
            <Icon className="size-3.5" />
          </Button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
