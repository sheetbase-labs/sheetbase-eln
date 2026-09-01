import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

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
  NotebookRecord,
  SubmissionDigestPreview,
} from '#/lib/notebook-data'
import {
  submissionCanonicalSignature,
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

/** Deep copy of a block so the frozen preview cannot observe later edits. */
function cloneBlock(block: NotebookBlock): NotebookBlock {
  return {
    ...block,
    payload:
      typeof structuredClone === 'function'
        ? structuredClone(block.payload)
        : (JSON.parse(JSON.stringify(block.payload)) as Record<
            string,
            unknown
          >),
  }
}

/** The frozen record metadata the preview renders while the digest holds. */
interface FrozenRecordMeta {
  title: string
  status: string
  properties: Record<string, unknown>
  structureVersion: number
  metadataVersion: number
}

function frozenRecordMeta(record: NotebookRecord): FrozenRecordMeta {
  return {
    title: record.title,
    status: record.status,
    properties:
      typeof structuredClone === 'function'
        ? structuredClone(record.properties)
        : (JSON.parse(JSON.stringify(record.properties)) as Record<
            string,
            unknown
          >),
    structureVersion: record.structureVersion,
    metadataVersion: record.metadataVersion,
  }
}

/**
 * Everything the dialog needs to describe "what submitting will pin", bound
 * to the digest the server verified. Rendered exclusively from this snapshot
 * — never from the live props — while it stays valid.
 */
interface VerifiedSubmission {
  digest: SubmissionDigestPreview
  blocks: NotebookBlock[]
  record: FrozenRecordMeta | null
  /** Canonical signature of the inputs at verification time. */
  signature: string
}

/**
 * NOTE-04 — submit dialog with an honest readiness checklist and an evidence
 * preview. The checklist is derived from canonical state (unsaved drafts,
 * lifecycle state, the server digest check, reviewer requirements) and the
 * preview reuses the read-only block previews to show what submission will
 * pin. When `preview_submission_digest` verifies, an exact snapshot of the
 * verified inputs (blocks, record metadata) is frozen into dialog state and
 * bound to the digest via `submissionCanonicalSignature`; any later change to
 * those inputs invalidates the snapshot immediately, so the checklist drops
 * back to pending and the preview is withheld until re-verification. The
 * preview is explicitly not evidence: the frozen snapshot and the record lock
 * are created only when the submit RPC succeeds.
 */
export function SubmitNotebookDialog({
  open,
  onOpenChange,
  recordId,
  projectId,
  reviewerUserId,
  workspaceId,
  record = null,
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
  /** NOTE-04: live record from the route's query cache, for snapshot binding. */
  record?: NotebookRecord | null
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
  const [verified, setVerified] = useState<VerifiedSubmission | null>(null)
  // Set when a previously verified snapshot was invalidated by a live
  // change, so the dialog can say why the checklist dropped back to pending.
  const [invalidated, setInvalidated] = useState(false)
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([
    reviewerUserId,
  ])

  useEffect(() => {
    if (open) {
      setVerified(null)
      setInvalidated(false)
      setSelectedReviewerIds([reviewerUserId])
    }
  }, [open, reviewerUserId])

  // NOTE-04 review fix: the live signature of the canonical inputs the
  // digest covers. While a verified snapshot exists, any drift between this
  // and the signature captured at verification time (record metadata, block
  // ids/versions/payloads) invalidates the snapshot immediately.
  const liveSignature = submissionCanonicalSignature({ record, blocks })
  useEffect(() => {
    setVerified((current) => {
      if (!current || current.signature === liveSignature) return current
      setInvalidated(true)
      return null
    })
  }, [liveSignature])

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

  // Latest observed canonical inputs and their signature, maintained
  // synchronously during render — not in an effect. A verification response
  // that settles after changed props have committed therefore always reads
  // the committed inputs, closing the window where an effect hadn't run yet
  // and a stale response was accepted against pre-change inputs.
  const inputsRef = useRef({ record, blocks })
  inputsRef.current = { record, blocks }
  const liveSignatureRef = useRef(liveSignature)
  liveSignatureRef.current = liveSignature
  // Signature of the inputs at the moment the verify request was issued. If
  // the live inputs drift while the RPC is in flight, the render-maintained
  // signature differs at response time and onSuccess discards the response.
  const requestSignatureRef = useRef<string | null>(null)

  const preview = useMutation({
    mutationFn: () => {
      requestSignatureRef.current = liveSignatureRef.current
      return previewSubmissionDigest(notebookDataClient, recordId)
    },
    onSuccess: (result) => {
      const { record: verifiedRecord, blocks: verifiedBlocks } =
        inputsRef.current
      // NOTE-04 in-flight race: compare the request-time signature against
      // the latest render-maintained signature. If the inputs changed while
      // the RPC was pending, this response verifies stale content — discard
      // it (do not set the snapshot) and leave the checklist pending until a
      // fresh verification.
      if (
        requestSignatureRef.current === null ||
        liveSignatureRef.current !== requestSignatureRef.current
      ) {
        setInvalidated(true)
        return
      }
      setVerified({
        digest: result,
        blocks: verifiedBlocks.map(cloneBlock),
        record: verifiedRecord ? frozenRecordMeta(verifiedRecord) : null,
        // Bind the frozen snapshot to the signature of the inputs the
        // server verified — any later drift invalidates the snapshot.
        signature: requestSignatureRef.current,
      })
      setInvalidated(false)
    },
  })
  const submit = useMutation({
    mutationFn: async () => {
      const expected =
        verified?.digest ??
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
    onError: () => setVerified(null),
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
    digest: verified?.digest.sourceDigest ?? null,
    digestPending: preview.isPending,
    digestError: previewErrorMessage,
  })
  const blocked = submissionHasBlockingChecks(checks)
  // NOTE-04 review fix: the evidence preview and its composition summary
  // render from the FROZEN snapshot, never from the live blocks, so the
  // dialog cannot claim "verified" while showing different content. The
  // "Sheets to check" links stay live — they are readiness navigation, not
  // the evidence preview.
  const frozenBlocks = verified?.blocks ?? []
  const sheetInstanceIds = submissionSheetInstanceIds(blocks)
  const composition = submissionCompositionSummary(frozenBlocks)
  const orderedBlocks = [...frozenBlocks].sort((a, b) => a.order - b.order)

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
        if (!next) {
          setVerified(null)
          setInvalidated(false)
        }
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

          {/* NOTE-04: preview of what submission will pin, rendered from
              the frozen snapshot bound to the verified digest. Reuses the
              read-only block previews; labelled as a preview, not evidence. */}
          {verified ? (
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
                {verified.digest.structureVersion} · metadata version{' '}
                {verified.digest.metadataVersion} · calculation input revision{' '}
                {verified.digest.calculationInputRevision}
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

          {verified ? (
            <p className="text-muted-foreground" role="status">
              Snapshot is ready to submit.
              <span className="mt-1 block break-all font-mono text-xs">
                Integrity check: {verified.digest.sourceDigest}
              </span>
            </p>
          ) : invalidated ? (
            <p className="text-muted-foreground" role="status">
              The Notebook changed since the last check — the snapshot above was
              cleared. Run “Check snapshot” again to verify the current content.
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
              !verified ||
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
