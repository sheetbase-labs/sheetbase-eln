import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import {
  notebookDataClient,
  previewSubmissionDigest,
  submitRecordRevision,
} from '#/lib/notebook-data'
import type {
  NotebookBlock,
  SubmissionDigestPreview,
} from '#/lib/notebook-data'
import {
  submissionCompositionSummary,
  submissionHasBlockingChecks,
  submissionReadinessChecks,
  submissionSheetInstanceIds,
} from '#/lib/notebook-submission'
import {
  reviewerCandidates,
  reviewerOptionLabel,
} from '#/lib/notebook-experience'
import { adminQueryKeys, fetchWorkspaceMembers } from '#/lib/workspace-admin'

import { BlockPreview } from './block-preview'

const WORKFLOW_KEY = 'default-scientific-review'
const WORKFLOW_VERSION = 1

/**
 * NOTE-04 — submit dialog with an honest readiness checklist and an evidence
 * preview. The checklist is derived from canonical state (unsaved drafts,
 * lifecycle state, the server digest check, reviewer requirements) and the
 * preview reuses the read-only block previews to show what submission will
 * pin. The preview is explicitly not evidence: the frozen snapshot and the
 * record lock are created only when the submit RPC succeeds.
 */
export function SubmitNotebookDialog({
  open,
  onOpenChange,
  recordId,
  projectId,
  reviewerUserId,
  workspaceId,
  blocks = [],
  hasUnsavedWork = false,
  archivedAt = null,
  lockedAt = null,
  activeReview = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  projectId: string
  reviewerUserId: string
  workspaceId?: string
  /** NOTE-04: live blocks in document order, for the evidence preview. */
  blocks?: NotebookBlock[]
  /** NOTE-04: NotebookDocument's unsaved-work signal. */
  hasUnsavedWork?: boolean
  /** NOTE-04: lifecycle fields mirrored from the live record. */
  archivedAt?: string | null
  lockedAt?: string | null
  activeReview?: boolean
}) {
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<SubmissionDigestPreview | null>(null)
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([
    reviewerUserId,
  ])

  useEffect(() => {
    if (open) {
      setSnapshot(null)
      setSelectedReviewerIds([reviewerUserId])
    }
  }, [open, reviewerUserId])

  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId ?? 'none'),
    queryFn: () => fetchWorkspaceMembers(notebookDataClient, workspaceId!),
    enabled: open && Boolean(workspaceId),
  })
  const reviewers = reviewerCandidates(members.data ?? [])
  const shownReviewers =
    reviewers.length > 0
      ? reviewers
      : [{ userId: reviewerUserId, role: 'member', suspendedAt: null }]

  const preview = useMutation({
    mutationFn: () => previewSubmissionDigest(notebookDataClient, recordId),
    onSuccess: (result) => setSnapshot(result),
  })
  const submit = useMutation({
    mutationFn: async () => {
      const expected =
        snapshot ??
        (await previewSubmissionDigest(notebookDataClient, recordId))
      return submitRecordRevision(notebookDataClient, {
        recordId,
        expectedSourceDigest: expected.sourceDigest,
        workflowDefinitionKey: WORKFLOW_KEY,
        workflowDefinitionVersion: WORKFLOW_VERSION,
        reviewerUserIds: selectedReviewerIds,
        idempotencyKey: crypto.randomUUID(),
      })
    },
    onSuccess: (result) => {
      onOpenChange(false)
      void navigate({
        to: '/reviews/$revisionId',
        params: { revisionId: result.revision.id },
      })
    },
    // NOTE-04 review fix: a server rejection (e.g. SB001 — the source
    // changed since the check snapshot) must invalidate the stale
    // snapshot, or the checklist keeps claiming the digest is verified
    // while Submit stays enabled against the same stale digest.
    onError: () => setSnapshot(null),
  })

  const previewErrorMessage =
    preview.error instanceof DataClientError
      ? preview.error.message
      : preview.error instanceof Error
        ? preview.error.message
        : null
  const submitErrorMessage =
    submit.error instanceof DataClientError
      ? submit.error.message
      : submit.error instanceof Error
        ? submit.error.message
        : null

  const checks = submissionReadinessChecks({
    hasUnsavedWork,
    archivedAt,
    lockedAt,
    activeReview,
    reviewerCount: selectedReviewerIds.length,
    digest: snapshot?.sourceDigest ?? null,
    digestPending: preview.isPending,
    digestError: previewErrorMessage,
  })
  const blocked = submissionHasBlockingChecks(checks)
  const sheetInstanceIds = submissionSheetInstanceIds(blocks)
  const composition = submissionCompositionSummary(blocks)
  const orderedBlocks = [...blocks].sort((a, b) => a.order - b.order)

  function toggleReviewer(userId: string) {
    setSelectedReviewerIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSnapshot(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submit for review</DialogTitle>
          <DialogDescription>
            Freezes this Notebook as submitted evidence. Later edits require an
            amendment. Work through the readiness checks, review what will be
            pinned, then confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Reviewers</legend>
            {shownReviewers.map((member) => (
              <label
                key={member.userId}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedReviewerIds.includes(member.userId)}
                  onChange={() => toggleReviewer(member.userId)}
                />
                <span>{reviewerOptionLabel(member, reviewerUserId)}</span>
              </label>
            ))}
          </fieldset>

          {/* NOTE-04: readiness derived from canonical state plus the
              server-owned digest check — no invented validation rules. */}
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Readiness</legend>
            <ul className="space-y-1.5" data-testid="submission-readiness">
              {checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className={
                      check.state === 'pass'
                        ? 'mt-0.5 font-medium text-emerald-600 dark:text-emerald-400'
                        : check.state === 'fail'
                          ? 'mt-0.5 font-medium text-destructive'
                          : 'mt-0.5 font-medium text-muted-foreground'
                    }
                  >
                    {check.state === 'pass'
                      ? '✓'
                      : check.state === 'fail'
                        ? '✕'
                        : '…'}
                  </span>
                  <span>
                    <span
                      className={
                        check.state === 'fail'
                          ? 'font-medium text-destructive'
                          : 'font-medium text-foreground'
                      }
                    >
                      {check.label}
                    </span>
                    <span className="block text-muted-foreground">
                      {check.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {sheetInstanceIds.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Sheets to check:{' '}
                {sheetInstanceIds.map((instanceId, index) => (
                  <span key={instanceId}>
                    {index > 0 ? ', ' : null}
                    <Link
                      to="/sheets/$instanceId"
                      params={{ instanceId }}
                      search={{ projectId }}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Sheet {instanceId.slice(0, 8)}
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}
          </fieldset>

          {/* NOTE-04: preview of what submission will pin. Reuses the
              read-only block previews; labelled as a preview, not evidence. */}
          {snapshot ? (
            <section
              aria-label="Evidence preview"
              className="space-y-2 rounded-md border p-3"
            >
              <p className="text-xs font-medium text-foreground" role="status">
                Preview — what submitting will pin
              </p>
              <p className="text-xs text-muted-foreground">
                This is a preview of the current Notebook, not yet evidence.
                Confirming creates the frozen snapshot and the digest above.
                Blocks already frozen (charts, analyses) keep their pinned
                versions; embedded Sheets freeze their current state.
              </p>
              <p className="text-xs text-muted-foreground">
                {composition.blockCount} block
                {composition.blockCount === 1 ? '' : 's'} ·{' '}
                {composition.sheetCount} embedded Sheet
                {composition.sheetCount === 1 ? '' : 's'} · structure version{' '}
                {snapshot.structureVersion} · metadata version{' '}
                {snapshot.metadataVersion} · calculation input revision{' '}
                {snapshot.calculationInputRevision}
              </p>
              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {orderedBlocks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    This Notebook has no blocks yet. Submitting would freeze an
                    empty document.
                  </p>
                ) : (
                  orderedBlocks.map((block) => (
                    <div
                      key={block.id}
                      className="rounded border border-border/60 p-2"
                    >
                      <BlockPreview block={block} />
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {snapshot ? (
            <p className="text-muted-foreground" role="status">
              Snapshot is ready to submit.
              <span className="mt-1 block break-all font-mono text-xs">
                Integrity check: {snapshot.sourceDigest}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              Check the current snapshot before submitting.
            </p>
          )}
          {previewErrorMessage ? (
            <p className="text-destructive" role="alert">
              {previewErrorMessage}
            </p>
          ) : null}
          {submitErrorMessage ? (
            <p className="text-destructive" role="alert">
              {submitErrorMessage}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={preview.isPending}
            onClick={() => preview.mutate()}
          >
            Check snapshot
          </Button>
          <Button
            type="button"
            disabled={
              submit.isPending ||
              preview.isPending ||
              blocked ||
              !snapshot ||
              selectedReviewerIds.length === 0
            }
            onClick={() => submit.mutate()}
          >
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
