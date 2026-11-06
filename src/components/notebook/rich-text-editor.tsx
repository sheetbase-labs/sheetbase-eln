import { t } from '#/copy'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, Extension, useEditor } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import Link from '@tiptap/extension-link'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { Icon } from '#/components/icons'

import { Button } from '#/components/ui/button'
import { RichTextContent } from '#/lib/blocks/rich-text'
import type { RichTextDocument, RichTextPayload } from '#/lib/blocks/rich-text'
import { cn } from '#/lib/utils'
import { colorForUser } from '#/lib/collaboration/provider'
import {
  AI_SLASH_TYPE,
  SlashCommandMenu,
  slashCommandFilterCount,
  slashCommandFilteredOptions,
} from './slash-command-menu'
import { AiComposer } from './ai-composer'
import { usePageAi } from '#/lib/use-page-ai'
import { useAnchoredPlacement } from '#/lib/use-anchored-placement'
import { fingerprint, liveFieldName, useLiveRichText } from './live-rich-text'

/** The slash menu's natural cap; it shrinks to fit above the keyboard. */
const SLASH_MENU_MAX_HEIGHT = 320

/**
 * The content extensions. `live` drops the editor's own undo history: while a
 * block is shared, undo belongs to the shared document so that pressing it
 * takes back only your own typing, never a collaborator's.
 */
function contentExtensions(live: boolean) {
  return [
    StarterKit.configure({
      ...(live ? { undoRedo: false as const } : {}),
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
}

const baseExtensions = contentExtensions(false)
const liveContentExtensions = contentExtensions(true)

/** How long a shared block must stay quiet before this person saves it too. */
const ADOPT_AFTER_MS = 4000
/** A conflict on a shared block is settled automatically at most this often. */
const MAX_AUTO_RESOLVES = 8

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
  /**
   * Live co-editing: the block's id. With a joined room that lets this person
   * write, the editor binds to the room's shared copy of the block so everyone
   * sees each other type. Without one it is the ordinary private editor.
   */
  liveBlockId?: string
  /**
   * Live co-editing: the block as last saved. A shared block is saved by
   * someone as soon as the author stops typing; this person saves it if nobody
   * has by then, so closing a tab never strands text only a peer was shown.
   */
  savedDoc?: RichTextDocument
  /** Live co-editing: the block's autosave reports a version conflict. */
  conflict?: boolean
  /** The newer saved copy the conflict is about. */
  conflictServerDoc?: RichTextDocument
  /** Live co-editing: save this person's (merged) text over the conflict. */
  onResolveConflict?: () => void
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
}

const SLASH_MENU_CLOSED: SlashMenuState = {
  open: false,
  query: '',
  index: 0,
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
  liveBlockId,
  savedDoc,
  conflict,
  conflictServerDoc,
  onResolveConflict,
  onSlashCommand,
  onEnterAtEnd,
  onBackspaceAtStart,
  onArrowUpFromStart,
  onArrowDownFromEnd,
  placeholder = t('notebook.richTextEditor.typeForBlocksOr'),
}: RichTextEditorProps) {
  const [slashMenu, setSlashMenu] =
    React.useState<SlashMenuState>(SLASH_MENU_CLOSED)

  // Track whether the editor has a non-empty text selection so the floating
  // toolbar can show/hide without layout shift.
  const [hasSelection, setHasSelection] = React.useState(false)

  // Refs so Tiptap's once-created callbacks always read the latest values.
  const slashMenuRef = React.useRef(slashMenu)
  slashMenuRef.current = slashMenu

  // "Write with AI": offered only when a real model is connected.
  const ai = usePageAi()
  const aiLiveRef = React.useRef(ai.live)
  aiLiveRef.current = ai.live
  const [aiComposer, setAiComposer] = React.useState<{
    selection: string
  } | null>(null)

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
  const payloadRef = React.useRef(payload)
  payloadRef.current = payload
  const editedRef = React.useRef(false)
  const { live, provider } = useLiveRichText({
    blockId: liveBlockId,
    extensions: baseExtensions,
    getSaved: () => payloadRef.current.doc,
    edited: () => editedRef.current,
  })
  const liveProvider = live ? provider : null
  const extensions = React.useMemo(() => {
    const decorations = Extension.create({
      name: 'notebookDecorations',
      addProseMirrorPlugins: () => decorationPlugins,
    })
    if (!liveProvider || !liveBlockId) return [...baseExtensions, decorations]
    const identity = liveProvider.identity
    return [
      ...liveContentExtensions,
      decorations,
      Collaboration.configure({
        document: liveProvider.doc,
        field: liveFieldName(liveBlockId),
      }),
      CollaborationCaret.configure({
        provider: liveProvider,
        // The caret extension writes this as my awareness `user`, which the
        // server checks against who I signed in as, so it carries the id.
        user: {
          id: identity?.id ?? '',
          name: identity?.name ?? '',
          avatar: identity?.avatar ?? null,
          color: identity?.color ?? colorForUser(identity?.id ?? ''),
        },
      }),
    ]
  }, [decorationPlugins, liveProvider, liveBlockId])

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

  const adoptTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(
    () => () => {
      if (adoptTimer.current) clearTimeout(adoptTimer.current)
    },
    [],
  )
  const savedDocRef = React.useRef(savedDoc)
  savedDocRef.current = savedDoc
  // Joining the shared document swaps the editor for one bound to the room.
  // The text is the same, so the swap must not cost the person their place:
  // remember where the caret was and put it back in the new editor.
  const placeRef = React.useRef<{
    from: number
    to: number
    focused: boolean
  } | null>(null)
  const restoreRef = React.useRef<typeof placeRef.current>(null)
  const lastLiveProvider = React.useRef(liveProvider)
  if (lastLiveProvider.current !== liveProvider) {
    lastLiveProvider.current = liveProvider
    restoreRef.current = placeRef.current
  }
  // Every state this editor has shown. A save that beat ours to the server and
  // matches one of them came from a collaborator, whose text we already hold;
  // a save that matches none came from outside the room and must not be
  // overwritten without asking.
  const seenStates = React.useRef<string[]>([])
  const noteState = (current: { getJSON: () => unknown }) => {
    const seen = seenStates.current
    const key = fingerprint(current.getJSON())
    if (seen[seen.length - 1] === key) return
    seen.push(key)
    if (seen.length > 200) seen.splice(0, seen.length - 200)
  }

  const editor = useEditor(
    {
      extensions,
      // A shared block takes its text from the room, never from a prop.
      content: liveProvider ? undefined : payload.doc,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          'aria-label': t('notebook.richTextEditor.textContent'),
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
              const count = slashCommandFilterCount(
                menu.query,
                aiLiveRef.current,
              )
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
              const filtered = slashCommandFilteredOptions(
                menu.query,
                aiLiveRef.current,
              )
              const selected = filtered.at(menu.index)
              if (!selected) return true
              if (selected.type === AI_SLASH_TYPE) {
                removeSlashQuery(view)
                setAiComposer({ selection: '' })
              } else if (selected.type === 'rich_text') {
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
                $from.depth === 1 &&
                $from.index(0) === doc.content.childCount - 1
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
                $from.depth === 1 &&
                $from.index(0) === doc.content.childCount - 1
              const isAtParaEnd =
                $from.parentOffset === $from.parent.content.size
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
      onCreate: ({ editor: created }) => {
        noteState(created)
        const place = restoreRef.current
        restoreRef.current = null
        if (!place) return
        const end = created.state.doc.content.size
        created.commands.setTextSelection({
          from: Math.min(place.from, end),
          to: Math.min(place.to, end),
        })
        if (place.focused)
          created.commands.focus(null, { scrollIntoView: false })
      },
      onFocus: ({ editor: focused }) => {
        placeRef.current = {
          from: focused.state.selection.from,
          to: focused.state.selection.to,
          focused: true,
        }
      },
      onUpdate: ({ editor: currentEditor, transaction }) => {
        noteState(currentEditor)
        // A change that arrived from a collaborator (not this person's own
        // typing or undo) is not an edit of theirs: it is saved by its author,
        // or by this person once the author has been quiet for a while.
        const sync = transaction.getMeta(ySyncPluginKey) as
          | { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean }
          | undefined
        if (sync?.isChangeOrigin && !sync.isUndoRedoOperation) {
          if (adoptTimer.current) clearTimeout(adoptTimer.current)
          adoptTimer.current = setTimeout(() => {
            adoptTimer.current = null
            const saved = savedDocRef.current
            if (currentEditor.isDestroyed || !saved) return
            const current = currentEditor.getJSON()
            const normalised = currentEditor.schema.nodeFromJSON(saved).toJSON()
            if (JSON.stringify(current) === JSON.stringify(normalised)) return
            editedRef.current = true
            cbRef.current.onChange({ doc: current as RichTextDocument })
          }, ADOPT_AFTER_MS)
          return
        }
        editedRef.current = true
        cbRef.current.onChange({
          doc: currentEditor.getJSON() as RichTextDocument,
        })
        checkSlashCommand(currentEditor)
      },
      onSelectionUpdate: ({ editor: currentEditor }) => {
        placeRef.current = {
          from: currentEditor.state.selection.from,
          to: currentEditor.state.selection.to,
          focused: currentEditor.view.hasFocus(),
        }
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
    },
    [liveProvider],
  )

  // A shared block's text comes from the room, so the saved copy must not be
  // pushed back into the editor.
  const serializedPayload = JSON.stringify(payload.doc)
  React.useEffect(() => {
    if (liveProvider) return
    if (
      !editor ||
      editor.isDestroyed ||
      JSON.stringify(editor.getJSON()) === serializedPayload
    )
      return
    editor.commands.setContent(payload.doc, { emitUpdate: false })
  }, [editor, liveProvider, payload.doc, serializedPayload])

  // The merged shared text is what everyone should end up with, so a version
  // conflict on a shared block is settled by saving it rather than asking the
  // person to choose between their half and someone else's.
  const autoResolves = React.useRef(0)
  const resolveRef = React.useRef(onResolveConflict)
  resolveRef.current = onResolveConflict
  React.useEffect(() => {
    if (!conflict || !liveProvider?.synced || !editor || editor.isDestroyed) {
      return
    }
    if (autoResolves.current >= MAX_AUTO_RESOLVES) return
    // Only a collaborator's save is settled here. Anything else that changed
    // the block is shown to the person to choose, as for any editor.
    if (!conflictServerDoc) return
    const theirs = fingerprint(
      editor.schema.nodeFromJSON(conflictServerDoc).toJSON(),
    )
    if (!seenStates.current.includes(theirs)) return
    autoResolves.current += 1
    editedRef.current = true
    cbRef.current.onChange({ doc: editor.getJSON() as RichTextDocument })
    resolveRef.current?.()
  }, [conflict, conflictServerDoc, editor, liveProvider])

  React.useEffect(() => {
    if (!editor || editor.isDestroyed || !autoFocus) return
    // Mid-swap into the shared document the caret is restored where it was.
    if (restoreRef.current) return
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

  // Both floating surfaces are placed from the live caret or selection on
  // every re-place, so they stay beside it inside the visible part of the
  // screen as the keyboard opens, the page pans or a pane scrolls.
  const slashMenuElRef = React.useRef<HTMLDivElement>(null)
  const slashPlacement = useAnchoredPlacement({
    open: slashMenu.open,
    ref: slashMenuElRef,
    maxHeight: SLASH_MENU_MAX_HEIGHT,
    getAnchor: () => {
      if (!editor || editor.isDestroyed) return null
      const c = editor.view.coordsAtPos(editor.state.selection.from)
      return { top: c.top, bottom: c.bottom, left: c.left }
    },
  })
  const toolbarRef = React.useRef<HTMLDivElement>(null)
  const toolbarPlacement = useAnchoredPlacement({
    open: hasSelection,
    ref: toolbarRef,
    maxHeight: Number.POSITIVE_INFINITY,
    prefer: 'top',
    gap: 8,
    getAnchor: () => {
      if (!editor || editor.isDestroyed) return null
      const { from, to } = editor.state.selection
      const start = editor.view.coordsAtPos(from)
      const end = editor.view.coordsAtPos(to)
      const width = toolbarRef.current?.offsetWidth ?? 0
      return {
        top: Math.min(start.top, end.top),
        bottom: Math.max(start.bottom, end.bottom),
        left: (start.left + end.right) / 2 - width / 2,
      }
    },
  })

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
      setSlashMenu({ open: true, query, index: 0 })
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
    if (type === AI_SLASH_TYPE) {
      if (editor) removeSlashQuery(editor.view)
      setAiComposer({ selection: '' })
    } else if (type === 'rich_text') {
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
    const href = window.prompt(t('notebook.richTextEditor.linkUrl'), 'https://')
    if (href) editor.chain().focus().setLink({ href }).run()
  }

  const controls = [
    {
      label: t('notebook.richTextEditor.label'),
      icon: <Icon name="pilcrow" className="size-3.5" />,
      active: editor.isActive('paragraph'),
      action: () => editor.chain().focus().setParagraph().run(),
    },
    {
      label: t('notebook.richTextEditor.heading2Label'),
      icon: <Icon name="heading2" className="size-3.5" />,
      active: editor.isActive('heading', { level: 2 }),
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: t('notebook.richTextEditor.heading3Label'),
      icon: <Icon name="heading3" className="size-3.5" />,
      active: editor.isActive('heading', { level: 3 }),
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: t('notebook.richTextEditor.boldLabel'),
      icon: <Icon name="bold" className="size-3.5" />,
      active: editor.isActive('bold'),
      action: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: t('notebook.richTextEditor.italicLabel'),
      icon: <Icon name="italic" className="size-3.5" />,
      active: editor.isActive('italic'),
      action: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: t('notebook.richTextEditor.linkLabel'),
      icon: <Icon name="link" className="size-3.5" />,
      active: editor.isActive('link'),
      action: setLink,
    },
    {
      label: t('notebook.richTextEditor.subscriptLabel'),
      icon: <Icon name="subscript" className="size-3.5" />,
      active: editor.isActive('subscript'),
      action: () => editor.chain().focus().toggleSubscript().run(),
    },
    {
      label: t('notebook.richTextEditor.superscriptLabel'),
      icon: <Icon name="superscript" className="size-3.5" />,
      active: editor.isActive('superscript'),
      action: () => editor.chain().focus().toggleSuperscript().run(),
    },
    {
      label: t('notebook.richTextEditor.inlineCodeLabel'),
      icon: <Icon name="code" className="size-3.5" />,
      active: editor.isActive('code'),
      action: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: t('notebook.richTextEditor.bulletListLabel'),
      icon: <Icon name="list" className="size-3.5" />,
      active: editor.isActive('bulletList'),
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: t('notebook.richTextEditor.orderedListLabel'),
      icon: <Icon name="listOrdered" className="size-3.5" />,
      active: editor.isActive('orderedList'),
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
    ...(ai.live
      ? [
          {
            label: t('notebook.aiComposer.askAi'),
            icon: <Icon name="spark" className="size-3.5" />,
            active: false,
            action: () => {
              const { from, to } = editor.state.selection
              setAiComposer({
                selection: editor.state.doc.textBetween(from, to, ' '),
              })
            },
            disabled: false,
          },
        ]
      : []),
    {
      label: t('notebook.richTextEditor.undoLabel'),
      icon: <Icon name="undo" className="size-3.5" />,
      active: false,
      action: () => editor.chain().focus().undo().run(),
      disabled: !editor.can().undo(),
    },
    {
      label: t('notebook.richTextEditor.redoLabel'),
      icon: <Icon name="redo" className="size-3.5" />,
      active: false,
      action: () => editor.chain().focus().redo().run(),
      disabled: !editor.can().redo(),
    },
  ]

  return (
    <div className={className}>
      <EditorContent editor={editor} />
      {aiComposer && ai.live ? (
        <AiComposer
          editor={editor}
          selection={aiComposer.selection}
          onClose={() => {
            setAiComposer(null)
            editor.commands.focus()
          }}
        />
      ) : null}
      {hasSelection ? (
        <div
          aria-label={t('notebook.richTextEditor.ariaLabel')}
          role="toolbar"
          ref={toolbarRef}
          className="z-50 flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md"
          style={toolbarPlacement.style}
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
      {slashMenu.open
        ? createPortal(
            <div data-slash-menu className="contents">
              <SlashCommandMenu
                ref={slashMenuElRef}
                withAi={ai.live}
                query={slashMenu.query}
                selectedIndex={slashMenu.index}
                onSelect={handleSlashSelect}
                onHoverIndex={(i) =>
                  setSlashMenu((m) => (m.index === i ? m : { ...m, index: i }))
                }
                style={slashPlacement.style}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
