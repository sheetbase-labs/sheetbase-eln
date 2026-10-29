/**
 * ASSIST-03 — Guided Scientific Workflows.
 *
 * Step-aware guidance across multi-object workflows. Workflow definitions are
 * data: ordered steps with object context, prerequisites as checkable
 * predicates over canonical state, and next actions that navigate to or
 * invoke the existing surface/accept path. The engine is pure and local —
 * evaluation returns JSON-serialisable guidance (no closures, no executors,
 * no writes). Execution happens through the same accept functions a user
 * would take (`GUIDED_ACCEPTS`, identical references to the canonical
 * operations), never through a parallel guided-write path — so permission,
 * provenance and audit are identical to the manual operations by
 * construction.
 *
 * assistance is marked throughout: every evaluated workflow carries the
 * assistance badge + note (PRODUCT.md:91), grounded facts first, guidance
 * never authoritative.
 */
import { t } from '#/copy'
import type { AssistExplanation, SheetWriteBackFailure } from './assist-explain'
import {
  ASSISTANCE_NOTE,
  explainBlockValidation,
  explainSheetWriteBack,
} from './assist-explain'
import { acceptTextDraft } from './assist-drafts'
import type { BlockValidationError } from './blocks'
import { promoteToChartSpec } from './comparative-view'
import { previewSubmissionDigest, submitRecordRevision } from './notebook-data'
import { submissionReadinessChecks } from './notebook-submission'
import type { SubmissionReadinessInput } from './notebook-submission'
import { approveReview, requestChangesOnReview } from './review-workspace'

/**
 * Badge rendered beside every guided workflow. Guidance is distinguishable
 * from canonical state: grounded step facts first, assistance clearly
 * marked, never authoritative.
 */
export const GUIDE_ASSISTANCE_BADGE = t(
  'notebook.assistGuide.guidedWorkflowAssistanceGuidance',
)

export type GuideStepState = 'done' | 'current' | 'blocked'

/**
 * Canonical accept functions a guided next action may invoke. Each entry is
 * the identical reference to the canonical operation (see the parity tests):
 * no new write path exists behind guidance.
 */
export const GUIDED_ACCEPTS = {
  promoteToChartSpec,
  acceptTextDraft,
  previewSubmissionDigest,
  submitRecordRevision,
  approveReview,
  requestChangesOnReview,
} as const

export type GuideAcceptKey = keyof typeof GUIDED_ACCEPTS

export type GuideActionTarget =
  | { kind: 'navigate'; href: string; hint: string }
  | { kind: 'accept'; acceptKey: GuideAcceptKey; hint: string }

export interface GuideAction {
  label: string
  target: GuideActionTarget
}

export interface GuideObjectContext {
  kind: 'dataset' | 'record' | 'notebook' | 'review'
  id: string
  deepLink: string
}

export interface GuideStep {
  id: string
  title: string
  detail: string
  objects: GuideObjectContext[]
  state: GuideStepState
  /** Why the step cannot advance: missing prerequisites (blocked) or the live-state reason (current). Null when done. */
  blockedReason: string | null
  /** ASSIST-01 grounded explanation where a builder fits the blocked step; null otherwise. */
  explanation: AssistExplanation | null
  /** Next actions for the current step; blocked steps point at the first missing prerequisite. Empty when done. */
  nextActions: GuideAction[]
}

export interface GuidedWorkflow {
  workflowId: 'analysis-to-figure' | 'submission-readiness'
  title: string
  description: string
  steps: GuideStep[]
  currentStepId: string | null
  complete: boolean
  marking: {
    badge: typeof GUIDE_ASSISTANCE_BADGE
    note: typeof ASSISTANCE_NOTE
  }
}

interface GuideStepDef<TState> {
  id: string
  title: string
  detail: string
  objects: (state: TState) => GuideObjectContext[]
  isDone: (state: TState) => boolean
  /** Live-state reason the step cannot advance yet (current step). Null when actionable. */
  waitingDetail: (state: TState) => string | null
  explanation: (state: TState) => AssistExplanation | null
  nextActions: (state: TState) => GuideAction[]
}

const MARKING = { badge: GUIDE_ASSISTANCE_BADGE, note: ASSISTANCE_NOTE }

function evaluate<TState>(
  workflowId: GuidedWorkflow['workflowId'],
  title: string,
  description: string,
  defs: Array<GuideStepDef<TState>>,
  state: TState,
): GuidedWorkflow {
  const done = defs.map((def) => def.isDone(state))
  const steps: GuideStep[] = defs.map((def, index) => {
    if (done[index]) {
      return {
        id: def.id,
        title: def.title,
        detail: def.detail,
        objects: def.objects(state),
        state: 'done' as const,
        blockedReason: null,
        explanation: null,
        nextActions: [],
      }
    }
    const missing = defs.slice(0, index).filter((_, prior) => !done[prior])
    if (missing.length > 0) {
      const first = missing[0]
      const firstObjects = defs[defs.indexOf(first)].objects(state)
      return {
        id: def.id,
        title: def.title,
        detail: def.detail,
        objects: def.objects(state),
        state: 'blocked' as const,
        blockedReason: t(
          missing.length === 1
            ? 'notebook.assistGuide.waitingOnOne'
            : 'notebook.assistGuide.waitingOnSeveral',
          { missing: missing.map((m) => `'${m.title}'`).join(', ') },
        ),
        explanation: null,
        nextActions: firstObjects[0]
          ? [
              {
                label: t('notebook.assistGuide.goToStep', {
                  step: first.title,
                }),
                target: {
                  kind: 'navigate',
                  href: firstObjects[0].deepLink,
                  hint: t('notebook.assistGuide.stepUnlocks', {
                    step: def.title,
                    prerequisite: first.title,
                  }),
                },
              },
            ]
          : [],
      }
    }
    return {
      id: def.id,
      title: def.title,
      detail: def.detail,
      objects: def.objects(state),
      state: 'current' as const,
      blockedReason: def.waitingDetail(state),
      explanation: def.explanation(state),
      nextActions: def.nextActions(state),
    }
  })
  const current = steps.find((step) => step.state === 'current') ?? null
  return {
    workflowId,
    title,
    description,
    steps,
    currentStepId: current?.id ?? null,
    complete: steps.every((step) => step.state === 'done'),
    marking: MARKING,
  }
}

// ---------------------------------------------------------------------------
// (a) Analysis → figure: dataset → compare → chart propose → notebook embed.
// ---------------------------------------------------------------------------

export interface AnalysisToFigureState {
  datasetId: string
  columnCount: number
  rowCount: number
  compareConfigValid: boolean
  chartSpecReady: boolean
  embeddedBlockId: string | null
  /** Notebook record the figure embeds into (navigation context). */
  recordId?: string
  /** Live block validation errors on the embed target (ASSIST-01 grounding). */
  blockErrors?: Array<{
    code: BlockValidationError
    field?: string
    message: string
  }>
  blockType?: string
}

function datasetLink(state: AnalysisToFigureState): string {
  return `/datasets/${state.datasetId}`
}

const ANALYSIS_DEFS: Array<GuideStepDef<AnalysisToFigureState>> = [
  {
    id: 'dataset-ready',
    title: t('notebook.assistGuide.title'),
    detail: t('notebook.assistGuide.detail'),
    objects: (s) => [
      { kind: 'dataset', id: s.datasetId, deepLink: datasetLink(s) },
    ],
    isDone: (s) => s.columnCount > 0 && s.rowCount > 0,
    waitingDetail: (s) =>
      s.columnCount <= 0
        ? t('notebook.assistGuide.theDatasetExposesNo')
        : t('notebook.assistGuide.theDatasetExposesNo2'),
    explanation: () => null,
    nextActions: (s) => [
      {
        label: t('notebook.assistGuide.openDatasetLabel'),
        target: {
          kind: 'navigate',
          href: datasetLink(s),
          hint: t('notebook.assistGuide.opensTheCanonicalDatasetHint'),
        },
      },
    ],
  },
  {
    id: 'compare-configured',
    title: t('notebook.assistGuide.compareConfiguredTitle'),
    detail: t('notebook.assistGuide.detail2'),
    objects: (s) => [
      { kind: 'dataset', id: s.datasetId, deepLink: datasetLink(s) },
    ],
    isDone: (s) => s.compareConfigValid,
    waitingDetail: () => t('notebook.assistGuide.noValidComparativeView'),
    explanation: () => null,
    nextActions: (s) => [
      {
        label: t('notebook.assistGuide.openCompareViewLabel'),
        target: {
          kind: 'navigate',
          href: datasetLink(s),
          hint: t('notebook.assistGuide.opensTheCanonicalCompareHint'),
        },
      },
    ],
  },
  {
    id: 'chart-proposed',
    title: t('notebook.assistGuide.chartProposedTitle'),
    detail: t('notebook.assistGuide.detail3'),
    objects: (s) => [
      { kind: 'dataset', id: s.datasetId, deepLink: datasetLink(s) },
    ],
    isDone: (s) => s.chartSpecReady,
    waitingDetail: () => t('notebook.assistGuide.noChartSpecYet'),
    explanation: () => null,
    nextActions: (s) => [
      {
        label: t('notebook.assistGuide.proposeChartFromCompareLabel'),
        target: {
          kind: 'accept',
          acceptKey: 'promoteToChartSpec',
          hint: t('notebook.assistGuide.runsTheOrdinaryPromotetochartspecHint'),
        },
      },
      {
        label: t('notebook.assistGuide.openChartConfiguratorLabel'),
        target: {
          kind: 'navigate',
          href: datasetLink(s),
          hint: t('notebook.assistGuide.opensTheCanonicalChartHint'),
        },
      },
    ],
  },
  {
    id: 'figure-embedded',
    title: t('notebook.assistGuide.figureEmbeddedTitle'),
    detail: t('notebook.assistGuide.detail4'),
    objects: (s) =>
      s.recordId
        ? [
            {
              kind: 'notebook',
              id: s.recordId,
              deepLink: `/records/${s.recordId}`,
            },
          ]
        : [{ kind: 'dataset', id: s.datasetId, deepLink: datasetLink(s) }],
    isDone: (s) => s.embeddedBlockId !== null,
    waitingDetail: () => t('notebook.assistGuide.theFigureIsProposed'),
    explanation: (s) =>
      s.blockErrors && s.blockErrors.length > 0
        ? explainBlockValidation({
            blockType: s.blockType ?? 'chart',
            errors: s.blockErrors,
          })
        : null,
    nextActions: (s) => [
      {
        label: t('notebook.assistGuide.embedFigureInNotebookLabel'),
        target: {
          kind: 'accept',
          acceptKey: 'acceptTextDraft',
          hint: t('notebook.assistGuide.runsTheOrdinaryAccepttextdraftHint'),
        },
      },
      ...(s.recordId
        ? [
            {
              label: t('notebook.assistGuide.openNotebookLabel'),
              target: {
                kind: 'navigate',
                href: `/records/${s.recordId}`,
                hint: t('notebook.assistGuide.opensTheCanonicalNotebookHint'),
              } as GuideActionTarget,
            },
          ]
        : []),
    ],
  },
]

/** Evaluate the analysis-to-figure workflow against live canonical state. Pure: returns guidance data only. */
export function evaluateAnalysisToFigure(
  state: AnalysisToFigureState,
): GuidedWorkflow {
  return evaluate(
    'analysis-to-figure',
    t('notebook.assistGuide.analysisToFigure'),
    t('notebook.assistGuide.datasetCompareChartPropose'),
    ANALYSIS_DEFS,
    state,
  )
}

// ---------------------------------------------------------------------------
// (b) Submission readiness: NOTE-04 checks → evidence preview → review.
// ---------------------------------------------------------------------------

export interface SubmissionReadinessState extends SubmissionReadinessInput {
  recordId: string
  submissionId: string | null
  revisionId?: string
  decision: string | null
  /** Live sheet write-back failures blocking the snapshot (ASSIST-01 grounding). */
  sheetFailures?: SheetWriteBackFailure[]
}

function readinessDetails(
  state: SubmissionReadinessState,
): Map<string, { state: string; detail: string }> {
  const checks = submissionReadinessChecks({
    hasUnsavedWork: state.hasUnsavedWork,
    archivedAt: state.archivedAt,
    lockedAt: state.lockedAt,
    activeReview: state.activeReview,
    reviewerCount: state.reviewerCount,
    digest: state.digest,
    digestPending: state.digestPending,
    digestError: state.digestError,
  })
  return new Map(
    checks.map((check) => [
      check.id,
      { state: check.state, detail: check.detail },
    ]),
  )
}

/**
 * Voice the NOTE-04 checklist detail as guidance: same canonical fact, but
 * marked as a live re-check so the guide never reads as a verbatim copy of
 * colocated dialog chrome (and stays distinguishable for assistive tech).
 */
function tracked(detail: string | null | undefined): string | null {
  if (!detail) return null
  return t('notebook.assistGuide.detailGuidanceReChecks', { detail })
}

function recordLink(state: SubmissionReadinessState): string {
  return `/records/${state.recordId}`
}

/**
 * The review workspace is addressed by revision (`/review/$revisionId`); there
 * is no page for bare `/review`. Until a revision exists the submission's state
 * is only readable on its record, so the link names the record instead of a
 * route the router answers with 'Not found'.
 */
function reviewLink(state: SubmissionReadinessState): string {
  return state.revisionId ? `/review/${state.revisionId}` : recordLink(state)
}

const SUBMISSION_DEFS: Array<GuideStepDef<SubmissionReadinessState>> = [
  {
    id: 'drafts-saved',
    title: t('notebook.assistGuide.draftsSavedTitle'),
    detail: t('notebook.assistGuide.detail5'),
    objects: (s) => [
      { kind: 'notebook', id: s.recordId, deepLink: recordLink(s) },
    ],
    isDone: (s) => !s.hasUnsavedWork,
    waitingDetail: (s) =>
      tracked(readinessDetails(s).get('unsaved-drafts')?.detail),
    explanation: () => null,
    nextActions: (s) => [
      {
        label: t('notebook.assistGuide.openNotebookLabel'),
        target: {
          kind: 'navigate',
          href: recordLink(s),
          hint: t('notebook.assistGuide.opensTheCanonicalNotebookHint2'),
        },
      },
    ],
  },
  {
    id: 'snapshot-verified',
    title: t('notebook.assistGuide.snapshotVerifiedTitle'),
    detail: t('notebook.assistGuide.detail6'),
    objects: (s) => [
      { kind: 'notebook', id: s.recordId, deepLink: recordLink(s) },
    ],
    isDone: (s) => s.digest !== null,
    waitingDetail: (s) =>
      tracked(readinessDetails(s).get('snapshot-digest')?.detail),
    explanation: (s) =>
      s.sheetFailures && s.sheetFailures.length > 0
        ? explainSheetWriteBack({ errors: s.sheetFailures })
        : null,
    nextActions: (s) => [
      {
        label: t('notebook.assistGuide.runSnapshotCheckLabel'),
        target: {
          kind: 'accept',
          acceptKey: 'previewSubmissionDigest',
          hint: t(
            'notebook.assistGuide.runsTheOrdinaryPreviewsubmissiondigestHint',
          ),
        },
      },
      {
        label: t('notebook.assistGuide.openNotebookLabel'),
        target: {
          kind: 'navigate',
          href: recordLink(s),
          hint: t('notebook.assistGuide.opensTheCanonicalNotebookHint3'),
        },
      },
    ],
  },
  {
    id: 'reviewers-assigned',
    title: t('notebook.assistGuide.reviewersAssignedTitle'),
    detail: t('notebook.assistGuide.detail7'),
    objects: (s) => [
      { kind: 'notebook', id: s.recordId, deepLink: recordLink(s) },
    ],
    isDone: (s) => s.reviewerCount > 0,
    waitingDetail: (s) => tracked(readinessDetails(s).get('reviewers')?.detail),
    explanation: () => null,
    nextActions: (s) => [
      {
        label: t('notebook.assistGuide.openSubmitDialogLabel'),
        target: {
          kind: 'navigate',
          href: recordLink(s),
          hint: t('notebook.assistGuide.opensTheCanonicalSubmitHint'),
        },
      },
    ],
  },
  {
    id: 'submitted',
    title: t('notebook.assistGuide.submittedTitle'),
    detail: t('notebook.assistGuide.detail8'),
    objects: (s) => [
      { kind: 'notebook', id: s.recordId, deepLink: recordLink(s) },
    ],
    isDone: (s) => s.submissionId !== null,
    waitingDetail: (s) => {
      const notebookState = readinessDetails(s).get('notebook-state')
      if (notebookState?.state === 'fail') return tracked(notebookState.detail)
      return t('notebook.assistGuide.snapshotVerifiedAndReviewers')
    },
    explanation: () => null,
    nextActions: () => [
      {
        label: t('notebook.assistGuide.submitRevisionLabel'),
        target: {
          kind: 'accept',
          acceptKey: 'submitRecordRevision',
          hint: t(
            'notebook.assistGuide.runsTheOrdinarySubmitrecordrevisionHint',
          ),
        },
      },
    ],
  },
  {
    id: 'review-decided',
    title: t('notebook.assistGuide.reviewDecidedTitle'),
    detail: t('notebook.assistGuide.detail9'),
    objects: (s) =>
      s.submissionId
        ? [
            {
              kind: 'review',
              id: s.submissionId,
              deepLink: reviewLink(s),
            },
          ]
        : [{ kind: 'notebook', id: s.recordId, deepLink: recordLink(s) }],
    isDone: (s) => s.decision !== null,
    waitingDetail: () => t('notebook.assistGuide.submittedAndAwaitingReviewer'),
    explanation: () => null,
    nextActions: (s) => [
      {
        label: t('notebook.assistGuide.approveReviewLabel'),
        target: {
          kind: 'accept',
          acceptKey: 'approveReview',
          hint: t('notebook.assistGuide.runsTheOrdinaryApprovereviewHint'),
        },
      },
      {
        label: t('notebook.assistGuide.requestChangesLabel'),
        target: {
          kind: 'accept',
          acceptKey: 'requestChangesOnReview',
          hint: t(
            'notebook.assistGuide.runsTheOrdinaryRequestchangesonreviewHint',
          ),
        },
      },
      // The review workspace only exists once a revision does, so before then
      // the step carries the decision accepts alone rather than a link to a
      // route the router answers with 'Not found'.
      ...(s.revisionId
        ? [
            {
              label: t('notebook.assistGuide.openReviewWorkspaceLabel'),
              target: {
                kind: 'navigate',
                href: reviewLink(s),
                hint: t('notebook.assistGuide.opensTheCanonicalReviewHint'),
              } as GuideActionTarget,
            },
          ]
        : []),
    ],
  },
]

/** Evaluate the submission-readiness workflow against live canonical state. Pure: returns guidance data only. */
export function evaluateSubmissionReadiness(
  state: SubmissionReadinessState,
): GuidedWorkflow {
  return evaluate(
    'submission-readiness',
    t('notebook.assistGuide.submissionReadiness'),
    t('notebook.assistGuide.note04ChecksEvidence'),
    SUBMISSION_DEFS,
    state,
  )
}
