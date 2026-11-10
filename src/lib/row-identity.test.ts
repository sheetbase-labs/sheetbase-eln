import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { resolveRowIdentityBatch, rowIdentityKey } from './row-identity'

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

    for (const [logicalType, invalidValue] of [
      ['reference', 'not-a-uuid'],
      ['date', '2026-02-30'],
      ['timestamp', '2026-08-15T25:00:00Z'],
      ['integer', 1.5],
    ] as const)
      expect(
        resolveRowIdentityBatch(
          { kind: 'source', columnIds: [sample], logicalTypes: [logicalType] },
          [{ [sample]: invalidValue }],
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

  it('hashes identity with SHA-256 matching Node crypto', () => {
    const spec = {
      kind: 'source' as const,
      columnIds: [sample],
      logicalTypes: ['text'] as const,
    }

    const values = ['hello']
    const key = rowIdentityKey(spec, values)

    const canonical = JSON.stringify({
      v: 1,
      kind: spec.kind,
      columns: spec.columnIds,
      types: spec.logicalTypes,
      values,
    })

    expect(key).toBe(
      `sb-row-v1:${createHash('sha256').update(canonical).digest('hex')}`,
    )
  })

  it('preserves UTF-8 hashing, JSON property order and raw serialization at SHA block boundaries', () => {
    const spec = {
      kind: 'composite' as const,
      columnIds: [timepoint, sample],
      logicalTypes: ['text', 'decimal'] as const,
    }

    for (let length = 0; length <= 129; length++) {
      const values = [
        'µ🧪\ud800"\n' + 'x'.repeat(length),
        { dose: 2, unit: 'µM' },
        undefined,
        null,
      ]

      const serialized = JSON.stringify({
        v: 1,
        kind: 'composite',
        columns: [timepoint, sample],
        types: ['text', 'decimal'],
        values,
      })

      expect(rowIdentityKey(spec, values)).toBe(
        `sb-row-v1:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`,
      )
      expect(rowIdentityKey(spec, values)).not.toBe(
        rowIdentityKey({ ...spec, columnIds: [sample, timepoint] }, values),
      )
      expect(rowIdentityKey(spec, values)).not.toBe(
        rowIdentityKey(spec, [
          values[0],
          { unit: 'µM', dose: 2 },
          undefined,
          null,
        ]),
      )
    }

    expect(rowIdentityKey(spec, [undefined])).toBe(rowIdentityKey(spec, [null]))
    expect(rowIdentityKey(spec, [{}])).not.toBe(
      rowIdentityKey(spec, [{ omitted: null }]),
    )
  })

  it('retains each declared scalar encoding and adjacent acceptance boundaries', () => {
    for (const [logicalType, value, encoded] of [
      ['text', '"µ"', 's:"\\"µ\\""'],
      ['integer', Number.MAX_SAFE_INTEGER, `i:${Number.MAX_SAFE_INTEGER}`],
      ['decimal', Number.MAX_VALUE, `d:${Number.MAX_VALUE}`],
      ['boolean', false, 'b:false'],
      ['date', '0001-01-01', 'd:0001-01-01'],
      ['date', '2000-02-29', 'd:2000-02-29'],
      [
        'timestamp',
        '2024-02-29T23:59:59.123456+23:59',
        't:2024-02-29T23:59:59.123456+23:59',
      ],
      [
        'reference',
        'A0000000-0000-8000-8000-000000000001',
        'u:a0000000-0000-8000-8000-000000000001',
      ],
      [
        'category',
        'A0000000-0000-4000-8000-000000000001',
        'u:a0000000-0000-4000-8000-000000000001',
      ],
    ] as const) {
      const spec = {
        kind: 'source' as const,
        columnIds: [sample],
        logicalTypes: [logicalType],
      }

      const serialized = JSON.stringify({
        v: 1,
        kind: 'source',
        columns: [sample],
        types: [logicalType],
        values: [encoded],
      })

      expect(resolveRowIdentityBatch(spec, [{ [sample]: value }])).toEqual({
        ok: true,
        rows: [
          {
            key: `sb-row-v1:${createHash('sha256').update(serialized).digest('hex')}`,
          },
        ],
      })
    }

    for (const [logicalType, value] of [
      ['integer', Number.MAX_SAFE_INTEGER + 1],
      ['integer', '2'],
      ['decimal', Infinity],
      ['decimal', NaN],
      ['boolean', 0],
      ['date', '1900-02-29'],
      ['date', '0000-01-01'],
      ['timestamp', '2024-02-29T23:59:60Z'],
      ['timestamp', '2024-02-29T23:59:59+24:00'],
      ['reference', '00000000-0000-0000-0000-000000000000'],
    ] as const) {
      expect(
        resolveRowIdentityBatch(
          { kind: 'source', columnIds: [sample], logicalTypes: [logicalType] },
          [{ [sample]: value }],
        ),
      ).toEqual({
        ok: false,
        errors: [{ code: 'invalid', row: 0, columnId: sample }],
      })
    }
  })

  it('keeps ordered diagnostics and reads only selected keys without reconstructing raw scientific rows', () => {
    const spec = {
      kind: 'composite' as const,
      columnIds: [sample, timepoint],
      logicalTypes: ['text', 'integer'] as const,
    }

    let unrelatedReads = 0

    const inherited = {
      __proto__: { [sample]: 'α' },
      [timepoint]: 2,
      get unrelated() {
        unrelatedReads++
        throw new Error('Unrelated scientific getter must not run.')
      },
    }

    expect(resolveRowIdentityBatch(spec, [inherited])).toEqual({
      ok: true,
      rows: [{ key: rowIdentityKey(spec, ['s:"α"', 'i:2']) }],
    })
    expect(unrelatedReads).toBe(0)
    expect(
      resolveRowIdentityBatch(spec, [
        {},
        { [sample]: null, [timepoint]: false },
        inherited,
        { [sample]: 'α', [timepoint]: 2 },
      ]),
    ).toEqual({
      ok: false,
      errors: [
        { code: 'missing', row: 0, columnId: sample },
        { code: 'missing', row: 0, columnId: timepoint },
        { code: 'missing', row: 1, columnId: sample },
        { code: 'invalid', row: 1, columnId: timepoint },
        {
          code: 'duplicate',
          row: 3,
          key: rowIdentityKey(spec, ['s:"α"', 'i:2']),
        },
      ],
    })
    expect(unrelatedReads).toBe(0)

    const nativeKeys = {
      ['__proto__']: 'raw',
      constructor: false,
      native: new Date('2024-02-29'),
    }

    expect(
      resolveRowIdentityBatch(
        {
          kind: 'composite',
          columnIds: ['__proto__', 'constructor'],
          logicalTypes: ['text', 'boolean'],
        },
        [nativeKeys],
      ).ok,
    ).toBe(true)
    expect(
      resolveRowIdentityBatch(
        { kind: 'composite', columnIds: [], logicalTypes: [] },
        [inherited],
      ),
    ).toEqual({ ok: false, errors: [{ code: 'invalid', row: 0 }] })
    expect(unrelatedReads).toBe(0)
  })

  it('generates reloadable local UUIDs while retaining supplied casing and duplicate ordering', () => {
    const spec = {
      kind: 'local' as const,
      columnIds: [local],
      logicalTypes: ['reference'] as const,
    }

    const generated = resolveRowIdentityBatch(spec, [{}, {}])

    expect(generated.ok).toBe(true)

    if (generated.ok) {
      expect(generated.rows[0].localId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      expect(generated.rows[0].key).not.toBe(generated.rows[1].key)
      expect(resolveRowIdentityBatch(spec, generated.rows)).toEqual(generated)
    }

    const supplied = 'A0000000-0000-4000-8000-000000000001'
    const key = rowIdentityKey(spec, [`u:${supplied.toLowerCase()}`])

    expect(resolveRowIdentityBatch(spec, [{ localId: supplied }])).toEqual({
      ok: true,
      rows: [{ key, localId: supplied }],
    })
    expect(
      resolveRowIdentityBatch(spec, [
        { localId: supplied },
        { localId: 'invalid' },
        { localId: supplied.toLowerCase() },
      ]),
    ).toEqual({
      ok: false,
      errors: [
        { code: 'invalid', row: 1, columnId: local },
        { code: 'duplicate', row: 2, key },
      ],
    })
  })
})
