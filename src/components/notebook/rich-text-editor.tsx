import * as React from 'react'
import { EditorContent, Extension, useEditor } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Redo2,
  SubscriptIcon,
  SuperscriptIcon,
  Undo2,
} from 'lucide-react'
import { Icon } from '#/components/icons'

import { Button } from '#/components/v3/ui/button'
import { RichTextContent } from '#/lib/blocks/rich-text'
import type { RichTextDocument, RichTextPayload } from '#/lib/blocks/rich-text'
import { cn } from '#/lib/utils'
import {
  SlashCommandMenu,
  slashCommandFilterCount,
  slashCommandFilteredOptions,
} from './slash-command-menu'

const baseExtensions = [
  StarterKit.configure({
    blockquote: false,
    codeBlock: false,
    hardBreak: false,
    heading: { levels: [2, 3] },
    horizontalRule: false,
    link: false,
    strike: false,
    trailingNode: false,
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
  /**
   * Where the caret lands when this editor takes focus. Moving down into a row
   * means the caret belongs at its start; moving up means its end. Without a
   * hint the caret goes to the end, which is where a click into the row puts
   * it.
   */
  caretHint?: 'start' | 'end'
  className?: string
  /**
   * NOTE-02: prefix for stable heading anchors (`<prefix>-h<index>`) added
   * to the editable DOM via ProseMirror node decorations, so outline links
   * resolve against active authoring content exactly as in read view. The
   * anchors live in the view only — never in the payload.
   */
  anchorPrefix?: string
  /**
   * NOTE-02 same-block collapse: top-level node indexes hidden by a
   * collapsed section. Applied as node decorations (`hidden print:contents`)
   * so the payload is untouched and print output stays expanded.
   */
  hiddenNodeIndexes?: ReadonlySet<number>
  /** Called when the user picks a block type from the slash command menu. */
  onSlashCommand?: (type: string) => void
  /** Enter at end of the last paragraph → create a new text block below. */
  onEnterAtEnd?: () => void
  /**
   * Backspace at the start of the block's first paragraph. The owner decides
   * what that means: inside a prose run it joins this row into the row above,
   * on an empty row it deletes the row, and otherwise nothing happens.
   */
  onBackspaceAtStart?: () => void
  /** ArrowUp at start of first paragraph → focus previous block. */
  onArrowUpFromStart?: () => void
  /** ArrowDown at end of last paragraph → focus next block. */
  onArrowDownFromEnd?: () => void
  /**
   * Shown as a widget decoration while the block is a single empty paragraph.
   * A decoration never enters the document, so it cannot be saved.
   */
  placeholder?: string
}

interface SlashMenuState {
  open: boolean
  query: string
  index: number
  top: number
  left: number
}

const SLASH_MENU_CLOSED: SlashMenuState = {
  open: false,
  query: '',
  index: 0,
  top: 0,
  left: 0,
}

/**
 * NOTE-02: ProseMirror decorations that mirror the read-view projection in
 * the editable DOM. Both plugins read refs, so they never need the editor to
 * be recreated; `viewRefreshEffect` below forces decoration recomputation
 * when the inputs change without any transaction of their own.
 */
const HEADING_ANCHOR_PLUGIN_KEY = new PluginKey('notebookHeadingAnchors')
const HIDDEN_NODES_PLUGIN_KEY = new PluginKey('notebookHiddenNodes')
const PLACEHOLDER_PLUGIN_KEY = new PluginKey('notebookPlaceholder')

/**
 * A2: an empty prose row would otherwise be an invisible caret with no target,
 * which is the single most obvious difference between an empty block and an
 * empty document. The placeholder is a widget decoration, so it is never part
 * of the document and can never be saved into a payload.
 */
function createPlaceholderPlugin(placeholderRef: React.RefObject<string>) {
  return new Plugin({
    key: PLACEHOLDER_PLUGIN_KEY,
    props: {
      decorations(state) {
        const { doc } = state
        if (doc.childCount !== 1) return DecorationSet.empty
        const only = doc.firstChild
        if (!only || only.type.name !== 'paragraph') return DecorationSet.empty
        if (only.content.size > 0) return DecorationSet.empty
        const widget = Decoration.widget(
          1,
          () => {
            const span = document.createElement('span')
            span.className = 'pointer-events-none select-none text-fg-muted/50'
            span.setAttribute('aria-hidden', 'true')
            span.textContent = placeholderRef.current
            return span
          },
          { side: -1 },
        )
        return DecorationSet.create(doc, [widget])
      },
    },
  })
}

function createDecorationPlugins(
  anchorPrefixRef: React.RefObject<string | undefined>,
  hiddenIndexesRef: React.RefObject<ReadonlySet<number> | undefined>,
  placeholderRef: React.RefObject<string>,
) {
  const headingAnchors = new Plugin({
    key: HEADING_ANCHOR_PLUGIN_KEY,
    props: {
      decorations(state) {
        const prefix = anchorPrefixRef.current
        if (!prefix) return DecorationSet.empty
        const decorations: Decoration[] = []
        state.doc.forEach((node, offset, index) => {
          if (node.type.name !== 'heading') return
          decorations.push(
            Decoration.node(offset, offset + node.nodeSize, {
              id: `${prefix}-h${index}`,
              class: 'scroll-mt-28',
            }),
          )
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
  const hiddenNodes = new Plugin({
    key: HIDDEN_NODES_PLUGIN_KEY,
    props: {
      decorations(state) {
        const hidden = hiddenIndexesRef.current
        if (!hidden || hidden.size === 0) return DecorationSet.empty
        const decorations: Decoration[] = []
        state.doc.forEach((node, offset, index) => {
          if (!hidden.has(index)) return
          decorations.push(
            Decoration.node(offset, offset + node.nodeSize, {
              class: 'hidden print:contents',
            }),
          )
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
  return [headingAnchors, hiddenNodes, createPlaceholderPlugin(placeholderRef)]
}

export function RichTextEditor({
  payload,
  onChange,
  onBlur,
  autoFocus,
  caretHint,
  className,
  anchorPrefix,
  hiddenNodeIndexes,
  onSlashCommand,
  onEnterAtEnd,
  onBackspaceAtStart,
  onArrowUpFromStart,
  onArrowDownFromEnd,
  placeholder = 'Type / for blocks, or just start writing',
}: RichTextEditorProps) {
  const [slashMenu, setSlashMenu] =
    React.useState<SlashMenuState>(SLASH_MENU_CLOSED)

  // Track whether the editor has a non-empty text selection so the floating
  // toolbar can show/hide without layout shift.
  const [hasSelection, setHasSelection] = React.useState(false)
  const [toolbarPos, setToolbarPos] = React.useState({ top: 0, left: 0 })

  // Refs so Tiptap's once-created callbacks always read the latest values.
  const slashMenuRef = React.useRef(slashMenu)
  slashMenuRef.current = slashMenu

  // NOTE-02 decoration inputs, read through refs by the plugins above so a
  // changed prefix or collapse state never recreates the editor.
  const anchorPrefixRef = React.useRef(anchorPrefix)
  anchorPrefixRef.current = anchorPrefix
  const hiddenIndexesRef = React.useRef(hiddenNodeIndexes)
  hiddenIndexesRef.current = hiddenNodeIndexes
  // The placeholder text is read through a ref for the same reason: the plugin
  // must stay stable, and the text is a prop with a default.
  const placeholderRef = React.useRef(placeholder)
  placeholderRef.current = placeholder
  // Created once — the plugin instances must stay stable for the editor's
  // lifetime or ProseMirror would tear down state on every render.
  const decorationPlugins = React.useRef(
    createDecorationPlugins(anchorPrefixRef, hiddenIndexesRef, placeholderRef),
  ).current
  const extensions = React.useMemo(
    () => [
      ...baseExtensions,
      Extension.create({
        name: 'notebookDecorations',
        addProseMirrorPlugins: () => decorationPlugins,
      }),
    ],
    [decorationPlugins],
  )

  const cbRef = React.useRef({
    onChange,
    onBlur,
    onSlashCommand,
    onEnterAtEnd,
    onBackspaceAtStart,
    onArrowUpFromStart,
    onArrowDownFromEnd,
  })
  cbRef.current = {
    onChange,
    onBlur,
    onSlashCommand,
    onEnterAtEnd,
    onBackspaceAtStart,
    onArrowUpFromStart,
    onArrowDownFromEnd,
  }

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
          'space-y-1.5 text-sm leading-6 text-fg outline-none [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-7 [&_h2]:tracking-tight [&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-6 [&_h3]:tracking-tight [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_ol]:pl-5 [&_p]:min-h-[1.25rem] [&_ul]:list-disc [&_ul]:space-y-0.5 [&_ul]:pl-5',
      },
      handleKeyDown: (view, event) => {
        const menu = slashMenuRef.current
        const cb = cbRef.current

        // --- Slash menu open: intercept navigation keys ---
        if (menu.open) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            const count = slashCommandFilterCount(menu.query)
            setSlashMenu((m) => ({
              ...m,
              index: Math.min(m.index + 1, Math.max(count - 1, 0)),
            }))
            return true
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSlashMenu((m) => ({ ...m, index: Math.max(m.index - 1, 0) }))
            return true
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            const filtered = slashCommandFilteredOptions(menu.query)
            const selected = filtered.at(menu.index)
            if (!selected) return true
            if (selected.type === 'rich_text') {
              // Stay in the same block — just remove the /query text.
              removeSlashQuery(view)
            } else {
              // Block will be replaced — no need to clean up editor text.
              cb.onSlashCommand?.(selected.type)
            }
            setSlashMenu(SLASH_MENU_CLOSED)
            return true
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setSlashMenu(SLASH_MENU_CLOSED)
            return true
          }
          // Any other key falls through to Tiptap, then onUpdate re-checks.
        }

        // --- Block-level keyboard navigation (menu closed) ---
        if (!menu.open) {
          const { doc, selection } = view.state
          const isCollapsed = selection.from === selection.to
          const hasModifier =
            event.altKey || event.ctrlKey || event.metaKey || event.shiftKey

          // Enter at end of the last top-level paragraph/heading → new block
          if (event.key === 'Enter' && !hasModifier && isCollapsed) {
            const $from = selection.$from
            const isLastTopLevel =
              $from.depth === 1 && $from.index(0) === doc.content.childCount - 1
            const isAtBlockEnd =
              $from.parentOffset === $from.parent.content.size
            if (
              isLastTopLevel &&
              isAtBlockEnd &&
              $from.parent.textContent.length > 0
            ) {
              event.preventDefault()
              cb.onEnterAtEnd?.()
              return true
            }
          }

          // Backspace at the start of the block's first paragraph. The owner
          // decides what happens: inside a prose run this joins the row into
          // the row above, on an empty row it deletes the row, and otherwise
          // nothing changes. Intercepting only at index 0 leaves ProseMirror's
          // own join (a paragraph after a heading) untouched.
          if (event.key === 'Backspace' && !hasModifier && isCollapsed) {
            const $from = selection.$from
            const isFirstTopLevel = $from.depth === 1 && $from.index(0) === 0
            if (isFirstTopLevel && $from.parentOffset === 0) {
              event.preventDefault()
              cb.onBackspaceAtStart?.()
              return true
            }
          }

          // ArrowUp at start of first paragraph → previous block
          if (event.key === 'ArrowUp' && !hasModifier && isCollapsed) {
            const $from = selection.$from
            const isFirstTopLevel = $from.depth === 1 && $from.index(0) === 0
            if ($from.parentOffset === 0 && isFirstTopLevel) {
              event.preventDefault()
              cb.onArrowUpFromStart?.()
              return true
            }
          }

          // ArrowDown at end of last paragraph → next block
          if (event.key === 'ArrowDown' && !hasModifier && isCollapsed) {
            const $from = selection.$from
            const isLastTopLevel =
              $from.depth === 1 && $from.index(0) === doc.content.childCount - 1
            const isAtParaEnd = $from.parentOffset === $from.parent.content.size
            if (isAtParaEnd && isLastTopLevel) {
              event.preventDefault()
              cb.onArrowDownFromEnd?.()
              return true
            }
          }
        }

        return false
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      cbRef.current.onChange({
        doc: currentEditor.getJSON() as RichTextDocument,
      })
      checkSlashCommand(currentEditor)
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      updateSelectionState(currentEditor)
    },
    onTransaction: ({ editor: currentEditor }) => {
      updateSelectionState(currentEditor)
    },
    onBlur: () => {
      cbRef.current.onBlur()
      setSlashMenu(SLASH_MENU_CLOSED)
      setHasSelection(false)
    },
  })

  const serializedPayload = JSON.stringify(payload.doc)
  React.useEffect(() => {
    if (!editor || JSON.stringify(editor.getJSON()) === serializedPayload)
      return
    editor.commands.setContent(payload.doc, { emitUpdate: false })
  }, [editor, payload.doc, serializedPayload])

  React.useEffect(() => {
    if (!editor || !autoFocus) return
    editor.commands.focus(caretHint === 'start' ? 'start' : 'end')
  }, [autoFocus, caretHint, editor])

  // NOTE-02: decoration inputs changed without a document transaction (e.g.
  // a section was collapsed or the block was renamed). Dispatch an empty
  // transaction so the plugins recompute their decorations. The no-op
  // transaction never changes the doc, so onUpdate does not fire.
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta('notebookDecorations', 1))
  }, [editor, anchorPrefix, hiddenNodeIndexes])

  // Close the slash menu when clicking outside the editor.
  React.useEffect(() => {
    if (!slashMenu.open) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-slash-menu]')) return
      setSlashMenu(SLASH_MENU_CLOSED)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [slashMenu.open])

  if (!editor) {
    return (
      <div className={className}>
        <RichTextContent
          payload={payload}
          anchorPrefix={anchorPrefix}
          hiddenNodeIndexes={hiddenNodeIndexes}
        />
      </div>
    )
  }

  // --- Slash command detection -------------------------------------------

  /**
   * Update the floating toolbar visibility and position based on the
   * current editor selection. The toolbar appears above the selected text.
   */
  function updateSelectionState(ed: typeof editor) {
    if (!ed) return
    const { from, to, empty } = ed.state.selection
    if (empty || from === to || slashMenuRef.current.open) {
      setHasSelection(false)
      return
    }
    // Calculate the bounding rect of the selection.
    const coords = ed.view.coordsAtPos(from)
    const coordsEnd = ed.view.coordsAtPos(to)
    setToolbarPos({
      top: Math.min(coords.top, coordsEnd.top) - 44,
      left: (coords.left + coordsEnd.right) / 2,
    })
    setHasSelection(true)
  }

  function checkSlashCommand(ed: typeof editor) {
    if (!ed) return
    const { $from } = ed.state.selection
    const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)
    const textAfter = $from.parent.textContent.slice($from.parentOffset)

    // Show menu when the paragraph starts with '/' and the cursor is right
    // after it (or after filter text), with no text after the cursor, and
    // no space in the query (space closes the menu, Notion-style).
    if (
      textBefore.startsWith('/') &&
      $from.parentOffset >= 1 &&
      textAfter === '' &&
      !textBefore.slice(1).includes(' ')
    ) {
      const query = textBefore.slice(1)
      const coords = ed.view.coordsAtPos($from.pos)
      setSlashMenu({
        open: true,
        query,
        index: 0,
        top: coords.bottom + 6,
        left: coords.left,
      })
    } else if (slashMenuRef.current.open) {
      setSlashMenu(SLASH_MENU_CLOSED)
    }
  }

  function removeSlashQuery(view: { state: unknown; dispatch: unknown }) {
    // Delete from the start of the current paragraph to the cursor.
    const { state, dispatch } = view as {
      state: {
        selection: { $from: { start: () => number; pos: number } }
        tr: { delete: (from: number, to: number) => unknown }
      }
      dispatch: (tr: unknown) => void
    }
    const start = state.selection.$from.start()
    const end = state.selection.$from.pos
    dispatch(state.tr.delete(start, end))
  }

  function handleSlashSelect(type: string) {
    if (type === 'rich_text') {
      if (editor) removeSlashQuery(editor.view)
    } else {
      cbRef.current.onSlashCommand?.(type)
    }
    setSlashMenu(SLASH_MENU_CLOSED)
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
      label: 'Paragraph',
      icon: <Pilcrow className="size-3.5" />,
      active: editor.isActive('paragraph'),
      action: () => editor.chain().focus().setParagraph().run(),
    },
    {
      label: 'Heading 2',
      icon: <Heading2 className="size-3.5" />,
      active: editor.isActive('heading', { level: 2 }),
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'Heading 3',
      icon: <Heading3 className="size-3.5" />,
      active: editor.isActive('heading', { level: 3 }),
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: 'Bold',
      icon: <Bold className="size-3.5" />,
      active: editor.isActive('bold'),
      action: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      icon: <Italic className="size-3.5" />,
      active: editor.isActive('italic'),
      action: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Link',
      icon: <Icon name="link" className="size-3.5" />,
      active: editor.isActive('link'),
      action: setLink,
    },
    {
      label: 'Subscript',
      icon: <SubscriptIcon className="size-3.5" />,
      active: editor.isActive('subscript'),
      action: () => editor.chain().focus().toggleSubscript().run(),
    },
    {
      label: 'Superscript',
      icon: <SuperscriptIcon className="size-3.5" />,
      active: editor.isActive('superscript'),
      action: () => editor.chain().focus().toggleSuperscript().run(),
    },
    {
      label: 'Inline code',
      icon: <Icon name="code" className="size-3.5" />,
      active: editor.isActive('code'),
      action: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: 'Bullet list',
      icon: <List className="size-3.5" />,
      active: editor.isActive('bulletList'),
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Ordered list',
      icon: <ListOrdered className="size-3.5" />,
      active: editor.isActive('orderedList'),
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Undo',
      icon: <Undo2 className="size-3.5" />,
      active: false,
      action: () => editor.chain().focus().undo().run(),
      disabled: !editor.can().undo(),
    },
    {
      label: 'Redo',
      icon: <Redo2 className="size-3.5" />,
      active: false,
      action: () => editor.chain().focus().redo().run(),
      disabled: !editor.can().redo(),
    },
  ]

  return (
    <div className={className}>
      <EditorContent editor={editor} />
      {hasSelection ? (
        <div
          aria-label="Text formatting"
          role="toolbar"
          className="fixed z-50 flex -translate-x-1/2 flex-wrap items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md"
          style={{ top: toolbarPos.top, left: toolbarPos.left }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {controls.map(({ label, icon, active, action, disabled }) => (
            <Button
              key={label}
              aria-label={label}
              aria-pressed={active || undefined}
              className={cn(
                'size-7 text-fg-muted shadow-none',
                active && 'bg-accent text-accent-foreground',
              )}
              disabled={disabled}
              onClick={action}
              onMouseDown={(event) => event.preventDefault()}
              size="icon"
              title={label}
              type="button"
              variant="quiet"
            >
              {icon}
            </Button>
          ))}
        </div>
      ) : null}
      {slashMenu.open ? (
        <div data-slash-menu className="contents">
          <SlashCommandMenu
            query={slashMenu.query}
            selectedIndex={slashMenu.index}
            onSelect={handleSlashSelect}
            onHoverIndex={(i) =>
              setSlashMenu((m) => (m.index === i ? m : { ...m, index: i }))
            }
            style={{
              position: 'fixed',
              top: slashMenu.top,
              left: slashMenu.left,
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
