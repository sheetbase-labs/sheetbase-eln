import { describe, expect, it } from 'vitest'

import {
  buildRevisionDocument,
  placeDocumentComments,
} from './revision-document'
import {
  DOCUMENT_REVISION_ID,
  EARLIER_REVISION_ID,
  commentFixture,
  documentFixtures,
} from './revision-document.test-fixtures'

describe('buildRevisionDocument', () => {
  it('reads the frozen revision in order with insertions, deletions and unchanged blocks', () => {
    const { before, after } = documentFixtures()
    const document = buildRevisionDocument(before, after)

    expect(document.blocks.map((block) => block.id)).toEqual([
      'block-objective',
      'block-method',
      'block-checklist',
      'block-removed',
      'block-added',
    ])
    expect(document.blocks.map((block) => [block.id, block.presence])).toEqual([
      ['block-objective', 'retained'],
      ['block-method', 'retained'],
      ['block-checklist', 'retained'],
      ['block-removed', 'removed'],
      ['block-added', 'added'],
    ])
    expect(document.changedBlockCount).toBe(3)
    expect(document.unchanged).toBe(false)

    const unchanged = document.blocks.find(
      (block) => block.id === 'block-objective',
    )
    expect(unchanged?.changes).toEqual([])
    expect(unchanged?.inline).toEqual([])

    const modified = document.blocks.find(
      (block) => block.id === 'block-method',
    )
    expect(modified?.inline).toHaveLength(1)
    expect(modified?.inline[0].before).toBe(
      'Cells were seeded at 2.0 × 10⁶ cells/mL.',
    )
    expect(modified?.inline[0].after).toBe(
      'Cells were seeded at 2.0 × 10⁶ cells/mL and transfected at 1.0 µg DNA/mL.',
    )

    // A removal keeps the predecessor as the block the document still shows.
    const removed = document.blocks.find(
      (block) => block.id === 'block-removed',
    )
    expect(removed?.block.id).toBe('block-removed')
    expect(removed?.before).toBeUndefined()
    expect(removed?.changes[0].kind).toBe('removed')

    // A modification carries both readings so the marks can name what changed.
    expect(modified?.before?.id).toBe('block-method')
    expect(modified?.block.id).toBe('block-method')
  })

  it('marks nothing and reports the document unchanged for a first revision', () => {
    const { after } = documentFixtures()
    const document = buildRevisionDocument(null, after)

    expect(document.comparison).toBeNull()
    expect(document.unchanged).toBe(true)
    expect(document.changedBlockCount).toBe(0)
    expect(document.blocks.every((block) => block.changes.length === 0)).toBe(
      true,
    )
  })
})

describe('placeDocumentComments', () => {
  const { before, after } = documentFixtures()
  const document = buildRevisionDocument(before, after)

  function place(
    comments: Parameters<typeof placeDocumentComments>[0]['comments'],
  ) {
    return placeDocumentComments({
      document,
      comments,
      revisionId: DOCUMENT_REVISION_ID,
      comparisonRevisionId: EARLIER_REVISION_ID,
    })
  }

  it('places a block comment and a change comment at their identities', () => {
    const textChange = document.diff.changes.find(
      (change) => change.area === 'text',
    )!
    const anchors = place([
      commentFixture({
        id: 'comment-block',
        target_kind: 'block',
        target: { blockId: 'block-method' },
      }),
      commentFixture({
        id: 'comment-change',
        target_kind: 'diff',
        target: {
          comparisonRevisionId: EARLIER_REVISION_ID,
          changeId: textChange.id,
          area: textChange.area,
          identity: textChange.identity,
        },
      }),
      commentFixture({ id: 'comment-revision' }),
      // The table carries no change, so it has no marked section — its anchor
      // still resolves against the frozen revision.
      commentFixture({
        id: 'comment-unchanged-table',
        target_kind: 'table_region',
        target: { tableId: 'table-1' },
      }),
    ])

    expect(
      anchors.map((anchor) => [anchor.comment.id, anchor.location]),
    ).toEqual([
      ['comment-block', { kind: 'block', blockId: 'block-method' }],
      ['comment-change', { kind: 'change', changeId: textChange.id }],
      ['comment-revision', { kind: 'revision' }],
      ['comment-unchanged-table', { kind: 'table', tableId: 'table-1' }],
    ])
    expect(anchors.every((anchor) => anchor.orphanReason === undefined)).toBe(
      true,
    )
    expect(document.tables).toEqual([])
  })

  it('never re-anchors a comment whose target no longer applies', () => {
    const textChange = document.diff.changes.find(
      (change) => change.area === 'text',
    )!
    const anchors = place([
      commentFixture({
        id: 'comment-earlier-round',
        revision_id: 'rev-first-round',
        target_kind: 'block',
        target: { blockId: 'block-method' },
      }),
      commentFixture({
        id: 'comment-other-comparison',
        target_kind: 'diff',
        target: {
          comparisonRevisionId: 'rev-third-round',
          changeId: textChange.id,
        },
      }),
      commentFixture({
        id: 'comment-gone-change',
        target_kind: 'diff',
        target: {
          comparisonRevisionId: EARLIER_REVISION_ID,
          changeId: 'text:block-method:doc:added',
        },
      }),
      commentFixture({
        id: 'comment-gone-block',
        target_kind: 'block',
        target: { blockId: 'block-deleted' },
      }),
      commentFixture({
        id: 'comment-gone-table',
        target_kind: 'table_region',
        target: { tableId: 'table-gone' },
      }),
      commentFixture({
        id: 'comment-gone-sheet',
        target_kind: 'sheet_cell',
        target: { instanceId: 'instance-1', rowKeys: ['row-1'], fieldIds: [] },
      }),
    ])

    expect(
      anchors.map((anchor) => [anchor.comment.id, anchor.orphanReason]),
    ).toEqual([
      ['comment-earlier-round', 'anchored-to-another-revision'],
      ['comment-other-comparison', 'comparison-changed'],
      ['comment-gone-change', 'change-not-in-comparison'],
      ['comment-gone-block', 'block-not-in-revision'],
      ['comment-gone-table', 'table-not-in-revision'],
      ['comment-gone-sheet', 'sheet-not-in-revision'],
    ])
    // The change the orphan named still exists: it must not be re-pointed at it.
    expect(
      document.diff.changes.some((change) => change.id === textChange.id),
    ).toBe(true)
    expect(anchors.every((anchor) => anchor.location === undefined)).toBe(true)
  })

  it('groups replies under their root and carries resolution state', () => {
    const anchors = place([
      commentFixture({ id: 'comment-root', state: 'resolved' }),
      commentFixture({
        id: 'comment-reply',
        parent_id: 'comment-root',
        root_id: 'comment-root',
        created_at: '2026-10-01T10:00:00Z',
      }),
    ])

    expect(anchors).toHaveLength(1)
    expect(anchors[0].resolved).toBe(true)
    expect(anchors[0].replies.map((reply) => reply.id)).toEqual([
      'comment-reply',
    ])
  })
})
