/**
 * EXP-04.5 — the actions a reader who cannot edit still has.
 *
 * View-only mode (`NbViewer`): the reader can read, copy and comment, and the
 * only write they may ask for is project edit access. That request goes
 * through the existing SET-02 RPC (`api.request_project_edit_access`, wrapped
 * by `requestProjectEditAccess`); a sent request is reported as pending
 * approval and a refusal is shown in the server's own words — never as a
 * success. The clipboard only ever receives what the reader selected.
 *
 * Signed mode (`NbSigned`): the notebook is read-only and the immutable
 * signatures bound to the record are shown inline with the frozen evidence,
 * reusing REV-02.3's `SignaturesTable` rather than a second table.
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import * as React from 'react'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field } from '#/components/v3/ui/input'
import { Textarea } from '#/components/v3/inventory/list'
import { SignaturesTable } from '#/components/review/signatures-table'
import { DataClientError } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchSignaturesForRecord, signatureQueryKeys } from '#/lib/signatures'
import { requestProjectEditAccess } from '#/lib/workspace-access'

/**
 * The comment affordance a block header renders for `blockId`. The reader's
 * Comment action opens the same thread the block's own button opens, so there
 * is one comment surface, not a second one.
 */
export function blockCommentButton(
  root: HTMLElement | null,
  blockId: string | null,
): HTMLButtonElement | null {
  if (!blockId) return null
  const block = root?.querySelector(`[id="block-${blockId}"]`)
  return (
    block?.querySelector<HTMLButtonElement>(
      '[aria-label^="Comments on block"]:not(:disabled)',
    ) ?? null
  )
}

/**
 * SET-02 access request, surfaced where the reader hits the wall. The dialog
 * states the three honest outcomes: sending, sent-and-pending, and the
 * server's refusal verbatim.
 */
export function RequestEditAccessDialog({
  open,
  onOpenChange,
  projectId,
  onRequested,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  /** Called only after the server accepted the request. */
  onRequested: () => void
}) {
  const [reason, setReason] = React.useState('')
  const request = useMutation({
    mutationFn: () =>
      requestProjectEditAccess(notebookDataClient, { projectId, reason }),
    onSuccess: () => {
      setReason('')
      onRequested()
      onOpenChange(false)
    },
  })

  const errorMessage =
    request.error instanceof DataClientError
      ? request.error.message
      : request.error instanceof Error
        ? request.error.message
        : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('')
          request.reset()
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title="Request edit access"
          description="Your request goes to the project owner. Access and its approval are recorded in the project's audit log."
        />
        <DialogBody>
          <Field
            label="Why you need it"
            hint="The owner decides from this reason alone."
            required
          >
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-label="Reason for the access request"
            />
          </Field>
          {errorMessage ? <Notice tone="bad">{errorMessage}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={request.isPending || reason.trim().length === 0}
            onClick={() => request.mutate()}
          >
            {request.isPending ? 'Sending…' : 'Send request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface NotebookViewerActionsProps {
  /** The project the record belongs to; the access request needs it. */
  projectId: string | null
  /** True when block comments can be opened (collaboration on, room ready). */
  commentEnabled: boolean
  /** The block the reader has selected, if any. */
  selectedBlockId: string | null
  /** The mounted document this bar acts on, never another copy. */
  documentRef?: React.RefObject<HTMLDivElement | null>
}

/**
 * The view-only bar: what the reader may do, and the one thing they may ask
 * for. Rendered above the document on the read-only path.
 */
export function NotebookViewerActions({
  projectId,
  commentEnabled,
  selectedBlockId,
  documentRef,
}: NotebookViewerActionsProps) {
  const [requestOpen, setRequestOpen] = React.useState(false)
  const [requested, setRequested] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [copyError, setCopyError] = React.useState<string | null>(null)
  const [selection, setSelection] = React.useState('')

  // Copy is offered exactly when there is a selection to copy, so the button
  // never promises the clipboard something it cannot deliver.
  React.useEffect(() => {
    const read = () => {
      const current = window.getSelection()
      setSelection(
        current &&
          documentRef?.current?.contains(current.anchorNode) &&
          documentRef.current.contains(current.focusNode)
          ? current.toString()
          : '',
      )
    }
    read()
    document.addEventListener('selectionchange', read)
    return () => document.removeEventListener('selectionchange', read)
  }, [documentRef])

  // A genuinely new selection invalidates the previous copy's confirmation.
  // Keying this on the selection text means a redundant selectionchange event
  // (same text) does not clear it.
  React.useEffect(() => {
    setCopied(false)
    setCopyError(null)
  }, [selection])

  async function copySelection() {
    if (selection.length === 0) return
    try {
      await navigator.clipboard.writeText(selection)
      setCopyError(null)
      setCopied(true)
    } catch {
      setCopied(false)
      setCopyError('Could not copy to the clipboard.')
    }
  }

  return (
    <div
      role="status"
      data-print-hide
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-surface-muted/40 px-3 py-2 text-xs"
    >
      <span className="text-fg-muted">
        You have view access to this project. You can read, copy and comment.
      </span>
      {requested ? (
        <span className="font-medium text-fg">
          Edit access requested — waiting for approval.
        </span>
      ) : null}
      {copyError ? (
        <span role="alert" className="text-danger-text">
          {copyError}
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={selection.length === 0}
          onClick={() => void copySelection()}
        >
          {copied ? 'Copied' : 'Copy selection'}
        </Button>
        {commentEnabled ? (
          <Button
            type="button"
            size="sm"
            disabled={!selectedBlockId}
            onClick={() =>
              blockCommentButton(
                documentRef?.current ?? null,
                selectedBlockId,
              )?.click()
            }
          >
            Comment
          </Button>
        ) : null}
        {projectId && !requested ? (
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() => setRequestOpen(true)}
          >
            Request edit access
          </Button>
        ) : null}
      </span>
      {requestOpen && projectId ? (
        <RequestEditAccessDialog
          open
          onOpenChange={(next) => {
            if (!next) setRequestOpen(false)
          }}
          projectId={projectId}
          onRequested={() => setRequested(true)}
        />
      ) : null}
    </div>
  )
}

/**
 * The signatures a signed (locked) record is bound to, shown with the frozen
 * evidence they attest. Reads only where a query client exists: SSR, the
 * pre-hydration paint and presentational renders have none, and they must not
 * open a connection or claim a failed load is an empty table.
 */
export function NotebookSignedSection({ recordId }: { recordId: string }) {
  const signatures = useQuery({
    queryKey: signatureQueryKeys.forRecord(recordId),
    queryFn: () => fetchSignaturesForRecord(notebookDataClient, recordId),
  })
  return (
    <div className="mx-auto mt-6 w-full max-w-[680px]">
      <h2 className="font-display text-base font-semibold text-fg">
        Signatures
      </h2>
      <SignaturesTable
        signatures={signatures.data ?? []}
        isLoading={signatures.isPending}
        isError={signatures.isError}
      />
    </div>
  )
}
