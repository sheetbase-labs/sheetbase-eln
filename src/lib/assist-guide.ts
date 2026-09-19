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
import type { AssistExplanation, SheetWriteBackFailure } from './assist-explain'
import {
  ASSISTANCE_NOTE,
  explainBlockValidation,
  explainSheetWriteBack,
} from './assist-explain'
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
export const GUIDE_ASSISTANCE_BADGE =
  'Guided workflow — assistance. Guidance only; every action runs the ordinary canonical operation with your permissions.' as const

export type GuideStepState = 'done' | 'current' | 'blocked'

/**
 * Canonical accept functions a guided next action may invoke. Each entry is
 * the identical reference to the canonical operation (see the parity tests):
 * no new write path exists behind guidance.
 */
export const GUIDED_ACCEPTS = {
  promoteToChartSpec,
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
        blockedReason:
          `Waiting on ${missing.map((m) => `'${m.title}'`).join(', ')} — ` +
          `complete ${missing.length === 1 ? 'it' : 'them'} first. Guidance re-checks live canonical state at every step.`,
        explanation: null,
        nextActions: firstObjects[0]
          ? [
              {
                label: `Go to '${first.title}'`,
                target: {
                  kind: 'navigate',
                  href: firstObjects[0].deepLink,
                  hint: `The '${def.title}' step unlocks once '${first.title}' is done. This only navigates — nothing is changed.`,
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
  return `/datasets?dataset=${state.datasetId}`
}

const ANALYSIS_DEFS: Array<GuideStepDef<AnalysisToFigureState>> = [
  {
    id: 'dataset-ready',
    title: 'Dataset ready',
    detail: 'The source dataset exposes columns and rows to analyse.',
    objects: (s) => [
      { kind: 'dataset', id: s.datasetId, deepLink: datasetLink(s) },
    ],
    isDone: (s) => s.columnCount > 0 && s.rowCount > 0,
    waitingDetail: (s) =>
      s.columnCount <= 0
        ? 'The dataset exposes no columns yet — map or ingest at least one field before comparing.'
        : 'The dataset exposes no rows yet — ingest data before comparing.',
    explanation: () => null,
    nextActions: (s) => [
      {
        label: 'Open dataset',
        target: {
          kind: 'navigate',
          href: datasetLink(s),
          hint: 'Opens the canonical dataset surface. Guidance only navigates — nothing is changed.',
        },
      },
    ],
  },
  {
    id: 'compare-configured',
    title: 'Compare configured',
    detail: 'A valid comparative view selects the value field and groupings.',
    objects: (s) => [
      { kind: 'dataset', id: s.datasetId, deepLink: datasetLink(s) },
    ],
    isDone: (s) => s.compareConfigValid,
    waitingDetail: () =>
      'No valid comparative-view config yet — pick a value field and at least one grouping on the compare surface.',
    explanation: () => null,
    nextActions: (s) => [
      {
        label: 'Open compare view',
        target: {
          kind: 'navigate',
          href: datasetLink(s),
          hint: 'Opens the canonical compare surface for this dataset. Guidance only navigates — nothing is changed.',
        },
      },
    ],
  },
  {
    id: 'chart-proposed',
    title: 'Chart proposed',
    detail:
      'The compare config is promoted to a chart spec through the canonical hand-off.',
    objects: (s) => [
      { kind: 'dataset', id: s.datasetId, deepLink: datasetLink(s) },
    ],
    isDone: (s) => s.chartSpecReady,
    waitingDetail: () =>
      'No chart spec yet — promote the valid compare config. The proposal is previewed before anything is committed.',
    explanation: () => null,
    nextActions: (s) => [
      {
        label: 'Propose chart from compare config',
        target: {
          kind: 'accept',
          acceptKey: 'promoteToChartSpec',
          hint: 'Runs the ordinary promoteToChartSpec hand-off on your compare config — the same function the compare surface uses. The spec is previewed before commit.',
        },
      },
      {
        label: 'Open chart configurator',
        target: {
          kind: 'navigate',
          href: datasetLink(s),
          hint: 'Opens the canonical chart configurator to review or adjust the proposed spec. Guidance only navigates — nothing is changed.',
        },
      },
    ],
  },
  {
    id: 'figure-embedded',
    title: 'Figure embedded',
    detail:
      'The figure is embedded in the notebook through the canonical block insert.',
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
    waitingDetail: () =>
      'The figure is proposed but not embedded yet — embed it as an ordinary notebook block from the record.',
    explanation: (s) =>
      s.blockErrors && s.blockErrors.length > 0
        ? explainBlockValidation({
            blockType: s.blockType ?? 'chart',
            errors: s.blockErrors,
          })
        : null,
    nextActions: (s) => [
      {
        label: 'Open notebook',
        target: {
          kind: 'navigate',
          href: s.recordId ? `/records/${s.recordId}` : '/',
          hint: 'Opens the canonical notebook surface, where the figure is embedded as an ordinary block. Guidance only navigates — nothing is changed.',
        },
      },
    ],
  },
]

/** Evaluate the analysis-to-figure workflow against live canonical state. Pure: returns guidance data only. */
export function evaluateAnalysisToFigure(
  state: AnalysisToFigureState,
): GuidedWorkflow {
  return evaluate(
    'analysis-to-figure',
    'Analysis to figure',
    'Dataset → compare → chart propose → notebook embed. Each step runs the ordinary surface or accept path.',
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
  return `${detail} Guidance re-checks this live canonical state at every step.`
}

function recordLink(state: SubmissionReadinessState): string {
  return `/records/${state.recordId}`
}

const SUBMISSION_DEFS: Array<GuideStepDef<SubmissionReadinessState>> = [
  {
    id: 'drafts-saved',
    title: 'Drafts saved',
    detail:
      'Every block edit is saved — the server snapshot sees what you see (NOTE-04 readiness).',
    objects: (s) => [
      { kind: 'notebook', id: s.recordId, deepLink: recordLink(s) },
    ],
    isDone: (s) => !s.hasUnsavedWork,
    waitingDetail: (s) =>
      tracked(readinessDetails(s).get('unsaved-drafts')?.detail),
    explanation: () => null,
    nextActions: (s) => [
      {
        label: 'Open notebook',
        target: {
          kind: 'navigate',
          href: recordLink(s),
          hint: 'Opens the canonical notebook to save or discard drafts. Guidance only navigates — nothing is changed.',
        },
      },
    ],
  },
  {
    id: 'snapshot-verified',
    title: 'Snapshot verified',
    detail:
      'The server digest pins the exact content submission will freeze (evidence preview).',
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
        label: 'Run snapshot check',
        target: {
          kind: 'accept',
          acceptKey: 'previewSubmissionDigest',
          hint: 'Runs the ordinary previewSubmissionDigest read with your permissions — the same check the submit dialog uses. Read-only; nothing is frozen.',
        },
      },
      {
        label: 'Open notebook',
        target: {
          kind: 'navigate',
          href: recordLink(s),
          hint: 'Opens the canonical notebook evidence preview. Guidance only navigates — nothing is changed.',
        },
      },
    ],
  },
  {
    id: 'reviewers-assigned',
    title: 'Reviewers assigned',
    detail:
      'At least one workspace reviewer is assigned — the server rejects submissions without one.',
    objects: (s) => [
      { kind: 'notebook', id: s.recordId, deepLink: recordLink(s) },
    ],
    isDone: (s) => s.reviewerCount > 0,
    waitingDetail: (s) => tracked(readinessDetails(s).get('reviewers')?.detail),
    explanation: () => null,
    nextActions: (s) => [
      {
        label: 'Open submit dialog',
        target: {
          kind: 'navigate',
          href: recordLink(s),
          hint: 'Opens the canonical submit dialog to pick reviewers. Guidance only navigates — nothing is changed.',
        },
      },
    ],
  },
  {
    id: 'submitted',
    title: 'Submitted',
    detail:
      'The verified snapshot is submitted as immutable revision evidence.',
    objects: (s) => [
      { kind: 'notebook', id: s.recordId, deepLink: recordLink(s) },
    ],
    isDone: (s) => s.submissionId !== null,
    waitingDetail: (s) => {
      const notebookState = readinessDetails(s).get('notebook-state')
      if (notebookState?.state === 'fail') return tracked(notebookState.detail)
      return 'Snapshot verified and reviewers assigned — confirm in the submit dialog to freeze the revision.'
    },
    explanation: () => null,
    nextActions: () => [
      {
        label: 'Submit revision',
        target: {
          kind: 'accept',
          acceptKey: 'submitRecordRevision',
          hint: 'Runs the ordinary submitRecordRevision RPC with your permissions — the same submit the dialog confirms. Explicit confirmation required; nothing is frozen until then.',
        },
      },
    ],
  },
  {
    id: 'review-decided',
    title: 'Review decided',
    detail: 'An assigned reviewer records a decision on the submission.',
    objects: (s) =>
      s.submissionId
        ? [
            {
              kind: 'review',
              id: s.submissionId,
              deepLink: s.revisionId ? `/reviews/${s.revisionId}` : '/reviews',
            },
          ]
        : [{ kind: 'notebook', id: s.recordId, deepLink: recordLink(s) }],
    isDone: (s) => s.decision !== null,
    waitingDetail: () =>
      'Submitted and awaiting reviewer decision — request changes or approve from the review workspace.',
    explanation: () => null,
    nextActions: (s) => [
      {
        label: 'Approve review',
        target: {
          kind: 'accept',
          acceptKey: 'approveReview',
          hint: 'Runs the ordinary approveReview transition RPC with your permissions — the same action the review workspace offers. Reviewer-only; nothing happens until you confirm.',
        },
      },
      {
        label: 'Request changes',
        target: {
          kind: 'accept',
          acceptKey: 'requestChangesOnReview',
          hint: 'Runs the ordinary requestChangesOnReview transition RPC with your permissions — the same action the review workspace offers. Reviewer-only; nothing happens until you confirm.',
        },
      },
      {
        label: 'Open review workspace',
        target: {
          kind: 'navigate',
          href: s.revisionId ? `/reviews/${s.revisionId}` : '/reviews',
          hint: 'Opens the canonical review workspace. Guidance only navigates — nothing is changed.',
        },
      },
    ],
  },
]

/** Evaluate the submission-readiness workflow against live canonical state. Pure: returns guidance data only. */
export function evaluateSubmissionReadiness(
  state: SubmissionReadinessState,
): GuidedWorkflow {
  return evaluate(
    'submission-readiness',
    'Submission readiness',
    'NOTE-04 checks → evidence preview → review actions. Each step runs the ordinary surface or accept path.',
    SUBMISSION_DEFS,
    state,
  )
}
