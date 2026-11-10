/**
 * The record header's own state: which dialog is open, what the record allows
 * this reader to do, the detour that reopens a dialog, and linking records.
 *
 * `StickyRecordHeader` composes these and renders; the notebook page no longer
 * holds every flag and every open/closed pair in one function.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { toast } from '#/components/ui/sonner'
import { useIsOnline } from '#/components/offline/offline-edits'
import { useRecordSubmitVariant } from '#/components/notebook/record-actions'
import { useHasSignatureToGive } from '#/components/notebook/sign-notebook-dialog'
import { useReportFrozen } from '#/components/workspace/workspace-navigation'
import { stepProgress } from '#/lib/step-status'
import {
  notebookLifecycleLabel,
  notebookReviewActivity,
  notebookReviewRevisionId,
} from '#/lib/notebook-experience'
import type { NotebookReviewContext } from '#/lib/notebook-experience'
import { deriveReviewActionPermission } from '#/lib/review-workspace'
import { reopenTaskFromSearch } from '#/lib/return-to'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'
import type {
  NotebookBlock as NotebookBlockDomain,
  NotebookRecord,
} from '#/lib/notebook-data'
import type { PickerItem } from '#/components/record-picker/record-picker-data'
import { t } from '#/copy'

/** The dialogs the header can open, and the one the link picker fills. */
export function useRecordHeaderDialogs() {
  const [submitOpen, setSubmitOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [labelOpen, setLabelOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [signOpen, setSignOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)

  return {
    submitOpen,
    setSubmitOpen,
    duplicateOpen,
    setDuplicateOpen,
    labelOpen,
    setLabelOpen,
    shareOpen,
    setShareOpen,
    signOpen,
    setSignOpen,
    withdrawOpen,
    setWithdrawOpen,
    linkOpen,
    setLinkOpen,
  }
}

/** The record's review posture: its lock, its lifecycle and the revision the
 * header can open. */
export function useRecordReviewState({
  record,
  review = null,
  historicalRevisionId,
  liveLockedAt,
  liveLockedByRevisionId,
}: {
  record: NotebookRecord
  review?: NotebookReviewContext | null
  historicalRevisionId?: string
  liveLockedAt?: string | null
  liveLockedByRevisionId?: string | null
}) {
  const lockedAt = liveLockedAt ?? record.lockedAt
  const lockedByRevisionId = liveLockedByRevisionId ?? record.lockedByRevisionId
  const reviewActivity = notebookReviewActivity(review)

  // NOTE-04: defensive for the submit dialog's readiness checklist — the
  // dialog only opens from a submittable header, but an active review that
  // appears between render and confirm is surfaced honestly.
  const activeReview = reviewActivity !== 'none'

  const lifecycle = notebookLifecycleLabel({
    lockedAt,
    archivedAt: record.archivedAt,
    reviewActivity,
    isHistorical: Boolean(historicalRevisionId),
  })

  const reviewRevisionId = notebookReviewRevisionId({
    lockedByRevisionId,
    review,
    historicalRevisionId,
  })

  return {
    lockedAt,
    lockedByRevisionId,
    reviewActivity,
    activeReview,
    lifecycle,
    reviewRevisionId,
    evidenceRevisionId: reviewRevisionId,
    canOpenReview: Boolean(reviewRevisionId),
  }
}

/** Whether this reader may submit, rename or be offered Submit at all. */
export function useRecordSubmitPermission({
  record,
  projectId,
  currentUserId,
  historicalRevisionId,
  reviewActivity,
  lockedAt,
  embedded,
  canWrite,
}: {
  record: NotebookRecord
  projectId?: string
  currentUserId?: string
  historicalRevisionId?: string
  reviewActivity: string
  lockedAt: string | null
  embedded: boolean
  canWrite: boolean
}) {
  const maySubmit = canWrite && Boolean(projectId && currentUserId)

  const canSubmit =
    maySubmit &&
    !lockedAt &&
    !record.archivedAt &&
    !historicalRevisionId &&
    reviewActivity === 'none'

  const canEditTitle =
    canWrite && !lockedAt && !record.archivedAt && !historicalRevisionId

  // On the experiment page a draft has one main action, Start experiment, in
  // the page header. Submit joins it once the experiment is running.
  const showSubmit = canSubmit && !(embedded && record.status === 'draft')

  return { canSubmit, canEditTitle, showSubmit }
}

/** A running experiment with protocol steps leads with the current step. Its
 * card carries Submit too, so the header's own Submit steps aside. */
export function useRecordStepCard({
  record,
  embedded,
  historicalRevisionId,
  hasParts,
  blocks,
}: {
  record: NotebookRecord
  embedded: boolean
  historicalRevisionId?: string
  hasParts: boolean
  blocks: NotebookBlockDomain[]
}) {
  const running =
    record.status === 'in_progress' || record.status === 'returned'

  const stepCardOn =
    embedded &&
    record.kind === 'experiment' &&
    running &&
    !historicalRevisionId &&
    !record.archivedAt &&
    (hasParts || stepProgress(blocks).length > 0)

  return { stepCardOn }
}

/** Whether this reader may sign the record's review. */
export function useRecordSignPermission({
  record,
  currentUserId,
  currentUserName,
  historicalRevisionId,
  reviewActivity,
  lockedAt,
  lockedByRevisionId,
  reviewRevisionId,
}: {
  record: NotebookRecord
  currentUserId?: string
  currentUserName?: string
  historicalRevisionId?: string
  reviewActivity: string
  lockedAt: string | null
  lockedByRevisionId: string | null
  reviewRevisionId: string | undefined
}) {
  const hasSignatureToGive = useHasSignatureToGive({
    revisionId: reviewRevisionId,
    currentUserId,
  })

  const approvedOrLocked =
    reviewActivity === 'approved' || Boolean(lockedAt && lockedByRevisionId)

  const canSign =
    Boolean(currentUserId && currentUserName) &&
    !historicalRevisionId &&
    !record.archivedAt &&
    approvedOrLocked &&
    hasSignatureToGive

  return { canSign }
}

/**
 * The submitter can take the notebook back out of review from here, under the
 * same rule the review page applies.
 */
export function useRecordWithdrawPermission({
  review = null,
  historicalRevisionId,
  currentUserId,
}: {
  review?: NotebookReviewContext | null
  historicalRevisionId?: string
  currentUserId?: string
}) {
  const withdrawable = review?.submission != null && review.revision != null

  if (historicalRevisionId || !withdrawable) return { canWithdraw: false }

  const canWithdraw = deriveReviewActionPermission({
    state: review.submission!.state,
    supersededByRevisionId: review.revision!.superseded_by_revision_id,
    assignedReviewerUserIds: review.submission!.assigned_reviewer_user_ids,
    submittedByUserId: review.submission!.submitted_by_user_id,
    currentUserId: currentUserId ?? '',
  }).canWithdraw

  return { canWithdraw }
}

/**
 * What this record, and this reader, may do from the header: submit, sign,
 * withdraw, open the review, edit the title, and whether the step card leads.
 */
export function useRecordHeaderFlags({
  record,
  projectId,
  currentUserId,
  currentUserName,
  historicalRevisionId,
  review = null,
  hasParts = false,
  blocks = [],
  embedded = false,
  canWrite = true,
  liveLockedAt,
  liveLockedByRevisionId,
}: {
  record: NotebookRecord
  projectId?: string
  currentUserId?: string
  currentUserName?: string
  historicalRevisionId?: string
  review?: NotebookReviewContext | null
  hasParts?: boolean
  blocks?: NotebookBlockDomain[]
  embedded?: boolean
  canWrite?: boolean
  liveLockedAt?: string | null
  liveLockedByRevisionId?: string | null
}) {
  const reviewState = useRecordReviewState({
    record,
    review,
    historicalRevisionId,
    liveLockedAt,
    liveLockedByRevisionId,
  })

  const submit = useRecordSubmitPermission({
    record,
    projectId,
    currentUserId,
    historicalRevisionId,
    reviewActivity: reviewState.reviewActivity,
    lockedAt: reviewState.lockedAt,
    embedded,
    canWrite,
  })

  const { stepCardOn } = useRecordStepCard({
    record,
    embedded,
    historicalRevisionId,
    hasParts,
    blocks,
  })

  const sign = useRecordSignPermission({
    record,
    currentUserId,
    currentUserName,
    historicalRevisionId,
    reviewActivity: reviewState.reviewActivity,
    lockedAt: reviewState.lockedAt,
    lockedByRevisionId: reviewState.lockedByRevisionId,
    reviewRevisionId: reviewState.reviewRevisionId,
  })

  const withdraw = useRecordWithdrawPermission({
    review,
    historicalRevisionId,
    currentUserId,
  })

  return { ...reviewState, ...submit, stepCardOn, ...sign, ...withdraw }
}

/**
 * Coming back from a detour (certifying a signature, for one) reopens the dialog
 * the person left, instead of leaving them to find the button again.
 */
export function useReopenTask({
  canSubmit,
  canSign,
  openSubmit,
  openSign,
}: {
  canSubmit: boolean
  canSign: boolean
  openSubmit: () => void
  openSign: () => void
}) {
  const navigate = useNavigate()

  const reopenTask = useRouterState({
    select: (state) => reopenTaskFromSearch(state.location.search),
  })

  const readyReopen =
    reopenTask === 'submit' ? canSubmit && reopenTask : canSign && reopenTask

  const [handledReopen, setHandledReopen] = useState<typeof readyReopen>(false)

  if (handledReopen !== readyReopen) {
    setHandledReopen(readyReopen)

    if (readyReopen === 'submit') openSubmit()
    else if (readyReopen === 'sign') openSign()
  }

  useEffect(() => {
    const task = reopenTask

    if (!task) return

    if (task === 'submit' && !canSubmit) return

    if (task === 'sign' && !canSign) return

    // eslint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Installed merged route declarations cannot express this unchanged relative search reducer across embedded routes; this does not validate search.
    void navigate({
      to: '.',
      search: (
        previous: ReturnType<typeof useRouterState>['location']['search'],
      ) => ({
        ...previous,
        reopen: undefined,
      }),
      replace: true,
    } as never)
  }, [canSubmit, canSign, navigate, reopenTask])

  // openSubmit/openSign only fire inside the render-phase block above.

  return { readyReopen, handledReopen }
}

/** Link records to this one, invalidating both lists that read the links. */
export function useLinkRecordLinks(recordId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (items: PickerItem[]) =>
      Promise.all(
        items.map((item) =>
          notebookDataClient.rpc('create_record_link', {
            p_source_record_id: recordId,
            p_target_kind: pickerRecordKind(item.kind),
            p_target_identifier: item.identifier,
            p_link_type: pickerLinkType(item.kind),
            p_target_record_id: item.id,
          }),
        ),
      ),
    onSuccess: (_result, items) => {
      void queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.links(recordId),
      })
      // The experiment page's Links tab reads the same rows under its own key.
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'experiment-links', recordId],
      })
      toast(
        items.length === 1
          ? t('notebook.notebookPage.recordLinked')
          : t('notebook.notebookPage.countRecordsLinked', {
              count: items.length,
            }),
      )
    },
    onError: () =>
      toast(t('notebook.notebookPage.couldNotLink'), {
        description: t('notebook.notebookPage.theRecordMayAlreadyDescription'),
      }),
  })
}

/** Which record kind a picked item is, as the link RPC names it. */
export function pickerRecordKind(kind: PickerItem['kind']): string {
  if (kind === 'Sample') return 'sample'

  if (kind === 'Material') return 'material'

  if (kind === 'Experiment') return 'experiment'

  return 'dataset'
}

/** The link type a picked item's relation is stored as. */
export function pickerLinkType(kind: PickerItem['kind']): string {
  if (kind === 'Sample') return 'sample'

  if (kind === 'Material') return 'material'

  return 'general'
}

/** The frozen notice the embedded experiment page reports. */
export function useFrozenReport({
  lockedAt,
  reviewActivity,
  embedded,
}: {
  lockedAt: string | null
  reviewActivity: string
  embedded: boolean
}) {
  return useReportFrozen(
    lockedAt ? true : reviewActivity === 'submitted' ? 'review' : false,
    embedded,
  )
}

/** The record's own online state, for the submit and sign buttons. */
export function useHeaderConnectivity() {
  const online = useIsOnline()
  const submitVariant = useRecordSubmitVariant()

  return { online, submitVariant }
}
