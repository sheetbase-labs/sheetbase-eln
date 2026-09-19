/**
 * ASSIST-03 tests. The engine is pure guidance data over canonical state:
 * steps resolve to done/current/blocked from live predicates, blocked steps
 * name their missing prerequisites, ASSIST-01 builders ground the steps they
 * fit, and next actions point only at existing surfaces/accept paths.
 * Parity: guided actions ARE the canonical accept functions (identical
 * references, identical client call sequences) and evaluated workflows carry
 * no executors — JSON-serialisable guidance only, so no new write path
 * exists behind guidance.
 */
import { describe, expect, it } from 'vitest'

import { approveReview, requestChangesOnReview } from './review-workspace'
import { promoteToChartSpec } from './comparative-view'
import { previewSubmissionDigest, submitRecordRevision } from './notebook-data'

import {
  evaluateAnalysisToFigure,
  evaluateSubmissionReadiness,
  GUIDED_ACCEPTS,
} from './assist-guide'
import type {
  AnalysisToFigureState,
  GuideAcceptKey,
  SubmissionReadinessState,
} from './assist-guide'

function analysisState(
  overrides: Partial<AnalysisToFigureState> = {},
): AnalysisToFigureState {
  return {
    datasetId: 'd1',
    columnCount: 0,
    rowCount: 0,
    compareConfigValid: false,
    chartSpecReady: false,
    embeddedBlockId: null,
    ...overrides,
  }
}

function submissionState(
  overrides: Partial<SubmissionReadinessState> = {},
): SubmissionReadinessState {
  return {
    recordId: 'r1',
    hasUnsavedWork: true,
    archivedAt: null,
    lockedAt: null,
    activeReview: false,
    reviewerCount: 0,
    digest: null,
    digestPending: false,
    digestError: null,
    submissionId: null,
    decision: null,
    ...overrides,
  }
}

describe('evaluateAnalysisToFigure', () => {
  it('starts on dataset-ready with later steps blocked on named prerequisites', () => {
    const workflow = evaluateAnalysisToFigure(analysisState())
    expect(workflow.workflowId).toBe('analysis-to-figure')
    expect(workflow.currentStepId).toBe('dataset-ready')
    expect(workflow.complete).toBe(false)
    expect(workflow.steps.map((s) => s.state)).toEqual([
      'current',
      'blocked',
      'blocked',
      'blocked',
    ])
    expect(workflow.steps[1]?.blockedReason).toContain('Dataset ready')
    expect(workflow.steps[1]?.nextActions[0]?.target).toMatchObject({
      kind: 'navigate',
    })
    // Done steps carry no actions or reasons; current step names the live gap.
    expect(workflow.steps[0]?.blockedReason).toContain('no columns')
    expect(workflow.steps[0]?.nextActions).toHaveLength(1)
  })

  it('walks dataset → compare → chart → embed as canonical state fills in', () => {
    const withDataset = evaluateAnalysisToFigure(
      analysisState({ columnCount: 3, rowCount: 10 }),
    )
    expect(withDataset.steps.map((s) => s.state)).toEqual([
      'done',
      'current',
      'blocked',
      'blocked',
    ])
    expect(withDataset.currentStepId).toBe('compare-configured')

    const compared = evaluateAnalysisToFigure(
      analysisState({ columnCount: 3, rowCount: 10, compareConfigValid: true }),
    )
    expect(compared.steps.map((s) => s.state)).toEqual([
      'done',
      'done',
      'current',
      'blocked',
    ])
    const chartStep = compared.steps[2]
    expect(chartStep.nextActions.map((a) => a.label)).toContain(
      'Propose chart from compare config',
    )
    expect(chartStep.nextActions[0].target).toMatchObject({
      kind: 'accept',
      acceptKey: 'promoteToChartSpec',
    })

    const proposed = evaluateAnalysisToFigure(
      analysisState({
        columnCount: 3,
        rowCount: 10,
        compareConfigValid: true,
        chartSpecReady: true,
        recordId: 'r1',
      }),
    )
    expect(proposed.steps.map((s) => s.state)).toEqual([
      'done',
      'done',
      'done',
      'current',
    ])
    expect(proposed.steps[3]?.nextActions[0]?.target).toMatchObject({
      kind: 'navigate',
      href: '/records/r1',
    })
    expect(proposed.currentStepId).toBe('figure-embedded')

    const done = evaluateAnalysisToFigure(
      analysisState({
        columnCount: 3,
        rowCount: 10,
        compareConfigValid: true,
        chartSpecReady: true,
        embeddedBlockId: 'b1',
        recordId: 'r1',
      }),
    )
    expect(done.complete).toBe(true)
    expect(done.currentStepId).toBeNull()
    expect(done.steps.every((s) => s.state === 'done')).toBe(true)
    expect(done.steps.every((s) => s.nextActions.length === 0)).toBe(true)
  })

  it('grounds a blocked embed step with the ASSIST-01 block explanation', () => {
    const workflow = evaluateAnalysisToFigure(
      analysisState({
        columnCount: 3,
        rowCount: 10,
        compareConfigValid: true,
        chartSpecReady: true,
        recordId: 'r1',
        blockType: 'chart',
        blockErrors: [
          {
            code: 'missing_required_field',
            field: 'y',
            message: 'y is required',
          },
        ],
      }),
    )
    const embed = workflow.steps[3]
    expect(embed.state).toBe('current')
    expect(embed.explanation?.title).toContain('chart')
    expect(embed.explanation?.citations[0]?.label).toContain(
      'missing_required_field',
    )
  })

  it('marks assistance on every evaluation', () => {
    const workflow = evaluateAnalysisToFigure(analysisState())
    expect(workflow.marking.badge).toContain('Guidance only')
    expect(workflow.marking.note).toContain('Not authoritative')
  })
})

describe('evaluateSubmissionReadiness', () => {
  it('starts on drafts-saved with NOTE-04 check detail as the reason', () => {
    const workflow = evaluateSubmissionReadiness(submissionState())
    expect(workflow.workflowId).toBe('submission-readiness')
    expect(workflow.currentStepId).toBe('drafts-saved')
    expect(workflow.steps.map((s) => s.state)).toEqual([
      'current',
      'blocked',
      'blocked',
      'blocked',
      'blocked',
    ])
    expect(workflow.steps[0]?.blockedReason).toContain('unsaved drafts')
    expect(workflow.steps[1]?.blockedReason).toContain('Drafts saved')
  })

  it('walks checks → digest → reviewers → submit → decision as state fills in', () => {
    const saved = evaluateSubmissionReadiness(
      submissionState({ hasUnsavedWork: false }),
    )
    expect(saved.currentStepId).toBe('snapshot-verified')
    expect(saved.steps[1]?.nextActions[0]?.target).toMatchObject({
      kind: 'accept',
      acceptKey: 'previewSubmissionDigest',
    })

    const verified = evaluateSubmissionReadiness(
      submissionState({ hasUnsavedWork: false, digest: 'abc123' }),
    )
    expect(verified.currentStepId).toBe('reviewers-assigned')
    expect(verified.steps[2]?.blockedReason).toContain('reviewer')

    const staffed = evaluateSubmissionReadiness(
      submissionState({
        hasUnsavedWork: false,
        digest: 'abc123',
        reviewerCount: 2,
      }),
    )
    expect(staffed.currentStepId).toBe('submitted')
    expect(staffed.steps[3]?.nextActions[0]?.target).toMatchObject({
      kind: 'accept',
      acceptKey: 'submitRecordRevision',
    })

    const submitted = evaluateSubmissionReadiness(
      submissionState({
        hasUnsavedWork: false,
        digest: 'abc123',
        reviewerCount: 2,
        submissionId: 'sub-1',
        revisionId: 'rev-1',
      }),
    )
    expect(submitted.currentStepId).toBe('review-decided')
    const acceptKeys = submitted.steps[4]?.nextActions
      .map((a) => a.target)
      .filter((t) => t.kind === 'accept')
      .map((t) => (t as { acceptKey: GuideAcceptKey }).acceptKey)
    expect(acceptKeys).toEqual(
      expect.arrayContaining(['approveReview', 'requestChangesOnReview']),
    )

    const decided = evaluateSubmissionReadiness(
      submissionState({
        hasUnsavedWork: false,
        digest: 'abc123',
        reviewerCount: 2,
        submissionId: 'sub-1',
        revisionId: 'rev-1',
        decision: 'approved',
      }),
    )
    expect(decided.complete).toBe(true)
    expect(decided.currentStepId).toBeNull()
  })

  it('surfaces the archived/locked guard on the submit step from NOTE-04 state', () => {
    const workflow = evaluateSubmissionReadiness(
      submissionState({
        hasUnsavedWork: false,
        digest: 'abc123',
        reviewerCount: 1,
        archivedAt: '2026-08-01T00:00:00Z',
      }),
    )
    expect(workflow.currentStepId).toBe('submitted')
    expect(workflow.steps[3].blockedReason).toContain('Archived')
  })

  it('grounds snapshot trouble with the ASSIST-01 sheet explanation', () => {
    const workflow = evaluateSubmissionReadiness(
      submissionState({
        hasUnsavedWork: false,
        sheetFailures: [
          { code: 'validation_failed', rowId: 'row-1', fieldId: 'temp' },
        ],
      }),
    )
    const snapshot = workflow.steps[1]
    expect(snapshot.state).toBe('current')
    expect(snapshot.explanation?.title).toContain('write-back')
    expect(snapshot.explanation?.citations[0]?.label).toContain(
      'validation_failed',
    )
  })
})

describe('execution parity (no new write paths)', () => {
  it('registers the identical canonical accept function references', () => {
    expect(GUIDED_ACCEPTS.promoteToChartSpec).toBe(promoteToChartSpec)
    expect(GUIDED_ACCEPTS.previewSubmissionDigest).toBe(previewSubmissionDigest)
    expect(GUIDED_ACCEPTS.submitRecordRevision).toBe(submitRecordRevision)
    expect(GUIDED_ACCEPTS.approveReview).toBe(approveReview)
    expect(GUIDED_ACCEPTS.requestChangesOnReview).toBe(requestChangesOnReview)
  })

  it('every guided next action resolves to the registry — never an inline executor', () => {
    const states: Array<
      | ReturnType<typeof evaluateAnalysisToFigure>
      | ReturnType<typeof evaluateSubmissionReadiness>
    > = [
      evaluateAnalysisToFigure(analysisState()),
      evaluateAnalysisToFigure(
        analysisState({
          columnCount: 2,
          rowCount: 5,
          compareConfigValid: true,
          chartSpecReady: true,
          recordId: 'r1',
        }),
      ),
      evaluateSubmissionReadiness(submissionState()),
      evaluateSubmissionReadiness(
        submissionState({
          hasUnsavedWork: false,
          digest: 'd',
          reviewerCount: 1,
          submissionId: 's',
          revisionId: 'rev-1',
        }),
      ),
    ]
    for (const workflow of states) {
      for (const step of workflow.steps) {
        for (const action of step.nextActions) {
          if (action.target.kind === 'accept') {
            expect(Object.keys(GUIDED_ACCEPTS)).toContain(
              action.target.acceptKey,
            )
            expect(typeof GUIDED_ACCEPTS[action.target.acceptKey]).toBe(
              'function',
            )
          }
        }
      }
    }
  })

  it('evaluated workflows are pure data: JSON round-trip preserves them (no closures/executors)', () => {
    const workflows = [
      evaluateAnalysisToFigure(analysisState({ columnCount: 2, rowCount: 5 })),
      evaluateSubmissionReadiness(
        submissionState({ sheetFailures: [{ code: 'validation_failed' }] }),
      ),
    ]
    for (const workflow of workflows) {
      expect(JSON.parse(JSON.stringify(workflow))).toEqual(workflow)
    }
  })

})
