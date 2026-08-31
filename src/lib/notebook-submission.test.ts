import { describe, expect, it } from 'vitest'

import type { NotebookBlock } from '#/lib/notebook-data'
import {
  submissionCompositionSummary,
  submissionHasBlockingChecks,
  submissionReadinessChecks,
  submissionSheetInstanceIds,
} from './notebook-submission'

function readyInput() {
  return {
    hasUnsavedWork: false,
    archivedAt: null,
    lockedAt: null,
    activeReview: false,
    reviewerCount: 1,
    digest: 'a'.repeat(64),
    digestPending: false,
    digestError: null,
  }
}

function check(
  checks: ReturnType<typeof submissionReadinessChecks>,
  id: string,
) {
  const found = checks.find((item) => item.id === id)
  if (!found) throw new Error(`missing check: ${id}`)
  return found
}

describe('submissionReadinessChecks', () => {
  it('passes every check for a saved, working, verified snapshot', () => {
    const checks = submissionReadinessChecks(readyInput())
    expect(checks.map((item) => item.state)).toEqual([
      'pass',
      'pass',
      'pass',
      'pass',
      'manual',
    ])
    expect(submissionHasBlockingChecks(checks)).toBe(false)
  })

  it('fails on unsaved drafts with a reason, blocking submit', () => {
    const checks = submissionReadinessChecks({
      ...readyInput(),
      hasUnsavedWork: true,
    })
    expect(check(checks, 'unsaved-drafts').state).toBe('fail')
    expect(check(checks, 'unsaved-drafts').detail).toContain(
      'not part of the server snapshot',
    )
    expect(submissionHasBlockingChecks(checks)).toBe(true)
  })

  it('fails for archived, locked or in-review Notebooks like the server does', () => {
    for (const override of [
      { archivedAt: '2026-08-01T00:00:00.000Z' },
      { lockedAt: '2026-08-01T00:00:00.000Z' },
      { activeReview: true },
    ]) {
      const checks = submissionReadinessChecks({ ...readyInput(), ...override })
      expect(check(checks, 'notebook-state').state).toBe('fail')
      expect(submissionHasBlockingChecks(checks)).toBe(true)
    }
  })

  it('surfaces the digest check as pending, then pass, then fail', () => {
    const pending = submissionReadinessChecks({
      ...readyInput(),
      digest: null,
      digestPending: true,
    })
    expect(check(pending, 'snapshot-digest').state).toBe('pending')

    const failed = submissionReadinessChecks({
      ...readyInput(),
      digest: null,
      digestPending: false,
      digestError: 'record denied',
    })
    expect(check(failed, 'snapshot-digest').state).toBe('fail')
    expect(check(failed, 'snapshot-digest').detail).toBe('record denied')
  })

  it('requires at least one reviewer, as the submit RPC does', () => {
    const checks = submissionReadinessChecks({
      ...readyInput(),
      reviewerCount: 0,
    })
    expect(check(checks, 'reviewers').state).toBe('fail')
    expect(submissionHasBlockingChecks(checks)).toBe(true)
  })

  it('never fabricates a pass for pending Sheet write-back', () => {
    const checks = submissionReadinessChecks(readyInput())
    const sheetCheck = check(checks, 'sheet-edits')
    expect(sheetCheck.state).toBe('manual')
    expect(sheetCheck.detail).toMatch(/cannot see pending cell edits/i)
    // A manual check alone never blocks — it points at the Sheet surface.
    expect(submissionHasBlockingChecks(checks)).toBe(false)
  })
})

const block = (
  id: string,
  type: string,
  payload: Record<string, unknown>,
  order: number,
): NotebookBlock => ({
  id,
  recordId: 'r1',
  type,
  payload,
  payloadSchemaVersion: 1,
  order,
  version: 1,
})

describe('submissionSheetInstanceIds', () => {
  it('collects embedded Sheet instance ids in document order', () => {
    const blocks = [
      block('b3', 'sheet', { instanceId: 'instance-b' }, 2),
      block('b1', 'rich_text', {}, 1),
      block('b2', 'sheet', { instanceId: 'instance-a' }, 3),
    ]
    expect(submissionSheetInstanceIds(blocks)).toEqual([
      'instance-b',
      'instance-a',
    ])
  })

  it('ignores non-canonical and malformed sheet blocks', () => {
    const blocks = [
      block('b1', 'sheet', {}, 1),
      block('b2', 'rich_text', {}, 2),
    ]
    expect(submissionSheetInstanceIds(blocks)).toEqual([])
  })

  it('summarises the composition honestly', () => {
    const blocks = [
      block('b1', 'rich_text', {}, 1),
      block('b2', 'sheet', { instanceId: 'instance-a' }, 2),
      block('b3', 'sheet', { instanceId: 'instance-a' }, 3),
    ]
    expect(submissionCompositionSummary(blocks)).toEqual({
      blockCount: 3,
      sheetCount: 2,
    })
  })
})
