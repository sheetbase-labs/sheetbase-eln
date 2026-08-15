import { describe, expect, it } from 'vitest'

import { resolveRowIdentityBatch } from './row-identity'

const sample = '10000000-0000-4000-8000-000000000001'
const timepoint = '10000000-0000-4000-8000-000000000002'
const local = '10000000-0000-4000-8000-000000000003'

describe('stable row identity', () => {
  it('keys source UUID and composite Sample/Timepoint rows independent of input order', () => {
    const source = {
      kind: 'source' as const,
      columnIds: [sample],
      logicalTypes: ['reference'] as const,
    }
    const composite = {
      kind: 'composite' as const,
      columnIds: [sample, timepoint],
      logicalTypes: ['reference', 'integer'] as const,
    }
    const rows = [
      { [sample]: 'a0000000-0000-4000-8000-000000000001', [timepoint]: 1 },
      { [sample]: 'a0000000-0000-4000-8000-000000000002', [timepoint]: 2 },
    ]
    const first = resolveRowIdentityBatch(source, rows)
    const reordered = resolveRowIdentityBatch(source, [...rows].reverse())
    const combined = resolveRowIdentityBatch(composite, rows)
    expect(first).toMatchObject({ ok: true })
    expect(reordered).toMatchObject({ ok: true })
    expect(combined).toMatchObject({ ok: true })
    if (first.ok && reordered.ok && combined.ok) {
      expect(new Set(first.rows.map((row) => row.key))).toEqual(
        new Set(reordered.rows.map((row) => row.key)),
      )
      expect(combined.rows[0].key).not.toBe(first.rows[0].key)
    }
  })

  it('persists a supplied local UUID and type-tags scalar values', () => {
    const spec = {
      kind: 'local' as const,
      columnIds: [local],
      logicalTypes: ['reference'] as const,
    }
    const first = resolveRowIdentityBatch(spec, [
      { localId: 'a0000000-0000-4000-8000-000000000001' },
    ])
    const reload = resolveRowIdentityBatch(spec, [
      { localId: 'a0000000-0000-4000-8000-000000000001' },
    ])
    const typed = resolveRowIdentityBatch(
      {
        kind: 'composite' as const,
        columnIds: [sample, timepoint],
        logicalTypes: ['text', 'boolean'] as const,
      },
      [
        { [sample]: '1', [timepoint]: true },
        { [sample]: '2', [timepoint]: true },
      ],
    )
    expect(first).toEqual(reload)
    expect(typed).toMatchObject({ ok: true })
    if (typed.ok) expect(typed.rows[0].key).not.toBe(typed.rows[1].key)
  })

  it('returns atomic structured missing, invalid and duplicate failures', () => {
    const spec = {
      kind: 'source' as const,
      columnIds: [sample],
      logicalTypes: ['text'] as const,
    }
    const result = resolveRowIdentityBatch(spec, [
      { [sample]: null },
      { [sample]: [] },
      { [sample]: 'x' },
      { [sample]: 'x' },
    ])
    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: 'missing', row: 0 }),
        expect.objectContaining({ code: 'invalid', row: 1 }),
        expect.objectContaining({ code: 'duplicate', row: 3 }),
      ]),
    })
  })

  it('uses declared types rather than runtime shapes and rejects invalid declared values', () => {
    const value = 'a0000000-0000-4000-8000-000000000001'
    const text = resolveRowIdentityBatch(
      { kind: 'source', columnIds: [sample], logicalTypes: ['text'] },
      [{ [sample]: value }],
    )
    const reference = resolveRowIdentityBatch(
      { kind: 'source', columnIds: [sample], logicalTypes: ['reference'] },
      [{ [sample]: value }],
    )
    const textDate = resolveRowIdentityBatch(
      { kind: 'source', columnIds: [sample], logicalTypes: ['text'] },
      [{ [sample]: '2026-08-15' }],
    )
    const date = resolveRowIdentityBatch(
      { kind: 'source', columnIds: [sample], logicalTypes: ['date'] },
      [{ [sample]: '2026-08-15' }],
    )
    expect(text).not.toEqual(reference)
    expect(textDate).not.toEqual(date)
    for (const [logicalType, value] of [
      ['reference', 'not-a-uuid'],
      ['date', '2026-02-30'],
      ['timestamp', '2026-08-15T25:00:00Z'],
      ['integer', 1.5],
    ] as const)
      expect(
        resolveRowIdentityBatch(
          { kind: 'source', columnIds: [sample], logicalTypes: [logicalType] },
          [{ [sample]: value }],
        ),
      ).toMatchObject({ ok: false, errors: [{ code: 'invalid' }] })
  })

  it('rejects malformed identity specifications', () => {
    expect(
      resolveRowIdentityBatch(
        { kind: 'local', columnIds: [local], logicalTypes: ['text'] },
        [{}],
      ),
    ).toMatchObject({ ok: false, errors: [{ code: 'invalid' }] })
    expect(
      resolveRowIdentityBatch(
        {
          kind: 'composite',
          columnIds: [sample, sample],
          logicalTypes: ['reference', 'reference'],
        },
        [],
      ),
    ).toMatchObject({ ok: false, errors: [{ code: 'invalid' }] })
  })
})
