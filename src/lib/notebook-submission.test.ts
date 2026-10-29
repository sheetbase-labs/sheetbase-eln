import { describe, expect, it } from 'vitest'

import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import {
  submissionCanonicalSignature,
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
    ])
    expect(submissionHasBlockingChecks(checks)).toBe(false)
  })

  it('adds a manual sheets check only when the notebook has sheets', () => {
    const checks = submissionReadinessChecks({ ...readyInput(), sheetCount: 2 })
    expect(checks.map((item) => item.state)).toEqual([
      'pass',
      'pass',
      'pass',
      'pass',
      'manual',
    ])
  })

  it('fails on unsaved drafts with a reason, blocking submit', () => {
    const checks = submissionReadinessChecks({
      ...readyInput(),
      hasUnsavedWork: true,
    })
    expect(check(checks, 'unsaved-drafts').state).toBe('fail')
    expect(check(checks, 'unsaved-drafts').detail).toContain('not saved yet')
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
    const checks = submissionReadinessChecks({ ...readyInput(), sheetCount: 1 })
    const sheetCheck = check(checks, 'sheet-edits')
    expect(sheetCheck.state).toBe('manual')
    expect(sheetCheck.detail).toMatch(/can’t see edits inside a sheet/i)
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
      // Distinct instances only — the same Sheet embedded twice is one
      // Sheet to check before submitting.
      sheetCount: 1,
    })
  })

  describe('submissionCanonicalSignature', () => {
    const record: NotebookRecord = {
      id: 'r1',
      projectId: 'p1',
      kind: 'experiment',
      identifier: 'EXP-001',
      title: 'Assay',
      status: 'working',
      tags: ['a'],
      structureVersion: 2,
      metadataVersion: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      archivedAt: null,
      deletedAt: null,
      createdByUserId: 'u1',
      updatedByUserId: null,
      properties: { dose: 10 },
      lockedAt: null,
      lockedByRevisionId: null,
    }
    const block: NotebookBlock = {
      id: 'b1',
      recordId: 'r1',
      type: 'rich_text',
      payload: { doc: { type: 'doc' } },
      payloadSchemaVersion: 1,
      order: 1,
      version: 1,
    }

    it('is stable for identical inputs, regardless of payload key order', () => {
      const a = submissionCanonicalSignature({ record, blocks: [block] })
      const reordered: NotebookRecord = {
        ...record,
        properties: { dose: 10 },
      }
      const b = submissionCanonicalSignature({
        record: reordered,
        blocks: [{ ...block, payload: { doc: { type: 'doc' } } }],
      })
      expect(b).toBe(a)
    })

    it('changes when a block payload, version or order changes', () => {
      const base = submissionCanonicalSignature({ record, blocks: [block] })
      expect(
        submissionCanonicalSignature({
          record,
          blocks: [{ ...block, version: 2 }],
        }),
      ).not.toBe(base)
      expect(
        submissionCanonicalSignature({
          record,
          blocks: [{ ...block, payload: { doc: { type: 'doc', x: 1 } } }],
        }),
      ).not.toBe(base)
      expect(
        submissionCanonicalSignature({
          record,
          blocks: [{ ...block, order: 2 }],
        }),
      ).not.toBe(base)
    })

    it('changes when record metadata or structure versions change', () => {
      const base = submissionCanonicalSignature({ record, blocks: [block] })
      const changed = (overrides: Partial<NotebookRecord>) =>
        submissionCanonicalSignature({
          record: { ...record, ...overrides },
          blocks: [block],
        })
      expect(changed({ title: 'Renamed' })).not.toBe(base)
      expect(changed({ metadataVersion: 2 })).not.toBe(base)
      expect(changed({ structureVersion: 3 })).not.toBe(base)
      expect(changed({ properties: { dose: 11 } })).not.toBe(base)
      expect(changed({ status: 'archived' })).not.toBe(base)
    })

    it('changes when the record identity changes or is absent', () => {
      const base = submissionCanonicalSignature({ record, blocks: [block] })
      expect(
        submissionCanonicalSignature({
          record: { ...record, id: 'r2' },
          blocks: [block],
        }),
      ).not.toBe(base)
      expect(
        submissionCanonicalSignature({ record: null, blocks: [block] }),
      ).not.toBe(base)
    })
  })
})

describe('submissionReadinessChecks reviewer minimum', () => {
  const ready = {
    hasUnsavedWork: false,
    archivedAt: null,
    lockedAt: null,
    activeReview: false,
    digest: 'a'.repeat(64),
    digestPending: false,
    digestError: null,
  }

  it('asks for the reviewer count the workspace names', () => {
    const one = submissionReadinessChecks({
      ...ready,
      reviewerCount: 1,
      minReviewers: 2,
    }).find((check) => check.id === 'reviewers')!
    expect(one.state).toBe('fail')
    expect(one.label).toBe('At least 2 reviewers are chosen')
    expect(one.detail).toMatch(/at least 2 reviewers/)

    const two = submissionReadinessChecks({
      ...ready,
      reviewerCount: 2,
      minReviewers: 2,
    }).find((check) => check.id === 'reviewers')!
    expect(two.state).toBe('pass')
  })
})
