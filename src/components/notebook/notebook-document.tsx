import * as React from 'react'

import { cn } from '#/lib/utils'
import type {
  NotebookBlock as NotebookBlockData,
  NotebookRecord,
} from '#/lib/notebook-data'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui'
import { NotebookBlock } from './notebook-block'
import { BlockPreview } from './block-preview'
import { BlockEditor } from './block-editor'
import { BlockPicker } from './block-picker'

/**
 * The editable notebook document (ELN-005). Owns the per-block editing,
 * insertion, duplication and deletion UX on top of the read-only canvas
 * from ELN-004. The parent supplies async mutation callbacks that perform
 * the RPCs and invalidate the route's queries; this component owns:
 *
 * - draft vs committed state (transient editor state is never stored as
 *   scientific content — drafts live in BlockEditor's local state);
 * - per-block saving/error state, including stale_version surfacing;
 * - a keyboard-accessible block picker for insertion;
 * - duplicate and delete actions with confirmation and undo where safe;
 * - a stable selection target and URL anchor per block (#block-<id>) so
 *   comments and review can refer to a block later.
 *
 * `readOnly` disables all mutations (archived notebooks).
 */

export interface NotebookDocumentProps {
  record: NotebookRecord
  blocks: NotebookBlockData[]
  /** Persist a validated payload for a block. Resolve on success, reject on error. */
  onSaveBlock: (
    block: NotebookBlockData,
    payload: Record<string, unknown>,
  ) => Promise<void>
  /** Insert a new block of `type`, optionally after `afterBlockId`. */
  onInsertBlock: (type: string, afterBlockId?: string) => Promise<void>
  /** Duplicate an existing block (same type/payload, inserted after it). */
  onDuplicateBlock: (block: NotebookBlockData) => Promise<void>
  /** Delete a block. */
  onDeleteBlock: (block: NotebookBlockData) => Promise<void>
  /** Re-insert a previously deleted block (undo). */
  onUndoDelete?: (
    type: string,
    payload: Record<string, unknown>,
    afterBlockId: string | null,
  ) => Promise<void>
  readOnly?: boolean
  className?: string
}

const EDITABLE_TYPES = new Set([
  'heading',
  'rich_text',
  'checklist',
  'linked_record',
])

export function NotebookDocument({
  record,
  blocks,
  onSaveBlock,
  onInsertBlock,
  onDuplicateBlock,
  onDeleteBlock,
  onUndoDelete,
  readOnly,
  className,
}: NotebookDocumentProps) {
  const [savingId, setSavingId] = React.useState<string | null>(null)
  const [errorById, setErrorById] = React.useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] =
    React.useState<NotebookBlockData | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState(false)
  const [undo, setUndo] = React.useState<{
    type: string
    payload: Record<string, unknown>
    afterBlockId: string | null
    label: string
  } | null>(null)

  // Scroll to the block named in the URL hash on mount (deep link to a block).
  React.useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash.startsWith('block-')) {
      const el = document.getElementById(hash)
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'start' })
      }
    }
  }, [])

  function selectBlock(block: NotebookBlockData) {
    setSelectedId(block.id)
    try {
      // Replace, not navigate, so the route guard and queries do not refire.
      window.history.replaceState(null, '', `#block-${block.id}`)
    } catch {
      /* jsdom/SSR: ignore */
    }
  }

  async function handleSave(
    block: NotebookBlockData,
    payload: Record<string, unknown>,
  ) {
    setSavingId(block.id)
    setErrorById((prev) => {
      const next = { ...prev }
      delete next[block.id]
      return next
    })
    try {
      await onSaveBlock(block, payload)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not save the block.'
      setErrorById((prev) => ({ ...prev, [block.id]: message }))
    } finally {
      setSavingId(null)
    }
  }

  async function handleInsert(type: string, afterBlockId?: string) {
    try {
      await onInsertBlock(type, afterBlockId)
      setUndo(null)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not insert the block.'
      setErrorById((prev) => ({ ...prev, __insert: message }))
    }
  }

  async function handleDuplicate(block: NotebookBlockData) {
    try {
      await onDuplicateBlock(block)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not duplicate the block.'
      setErrorById((prev) => ({ ...prev, [block.id]: message }))
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return
    setPendingDelete(true)
    try {
      await onDeleteBlock(confirmDelete)
      setUndo({
        type: confirmDelete.type,
        payload: confirmDelete.payload,
        afterBlockId: null,
        label: `${confirmDelete.type} block`,
      })
      setConfirmDelete(null)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not delete the block.'
      setErrorById((prev) => ({ ...prev, [confirmDelete.id]: message }))
    } finally {
      setPendingDelete(false)
    }
  }

  async function handleUndo() {
    if (!undo || !onUndoDelete) return
    try {
      await onUndoDelete(undo.type, undo.payload, undo.afterBlockId)
      setUndo(null)
    } catch {
      // If undo fails the user can still insert manually.
      setUndo(null)
    }
  }

  const isReadOnly = readOnly || record.archivedAt !== null

  return (
    <div className={cn('space-y-3', className)}>
      {blocks.length === 0 && isReadOnly ? null : null}
      {blocks.map((block) => {
        const editable = EDITABLE_TYPES.has(block.type) && !isReadOnly
        const isSelected = selectedId === block.id
        return (
          <div
            key={block.id}
            id={`block-${block.id}`}
            className="scroll-mt-28"
            onFocus={() => selectBlock(block)}
            onClick={() => selectBlock(block)}
          >
            <NotebookBlock
              label={blockLabel(block.type)}
              state={
                isReadOnly ? 'read-only' : isSelected ? 'editing' : 'default'
              }
              ariaLabel={`${block.type} block`}
              menuItems={
                isReadOnly
                  ? undefined
                  : [
                      {
                        id: 'duplicate',
                        label: 'Duplicate',
                        onSelect: () => handleDuplicate(block),
                      },
                      {
                        id: 'delete',
                        label: 'Delete',
                        onSelect: () => setConfirmDelete(block),
                        separatorAfter: true,
                      },
                    ]
              }
            >
              {editable ? (
                <BlockEditor
                  block={block}
                  onSave={(payload) => void handleSave(block, payload)}
                  saving={savingId === block.id}
                  serverError={errorById[block.id] ?? null}
                  readOnly={isReadOnly}
                  autoFocus={isSelected}
                />
              ) : (
                <BlockPreview block={block} />
              )}
            </NotebookBlock>
          </div>
        )
      })}

      {errorById.__insert ? (
        <p role="alert" className="text-xs text-destructive">
          {errorById.__insert}
        </p>
      ) : null}

      {isReadOnly ? null : (
        <BlockPicker
          onInsert={(type) => void handleInsert(type)}
          disabled={false}
          label="Add block"
        />
      )}

      {undo ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs"
        >
          <span>Block deleted.</span>
          {onUndoDelete ? (
            <button
              type="button"
              onClick={() => void handleUndo()}
              className="font-medium text-primary underline"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this block?</AlertDialogTitle>
            <AlertDialogDescription>
              The block will be removed from the notebook. You can undo
              immediately after deleting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingDelete}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirmDelete()}
              disabled={pendingDelete}
            >
              {pendingDelete ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function blockLabel(type: string): string {
  const map: Record<string, string> = {
    heading: 'Heading',
    rich_text: 'Text',
    checklist: 'Checklist',
    list: 'List',
    callout: 'Callout',
    linked_record: 'Linked record',
    table: 'Table',
    chart: 'Chart',
    plate_map: 'Plate map',
    file: 'File',
    metric: 'Metric',
    procedure_step: 'Procedure step',
  }
  return map[type] ?? type
}
