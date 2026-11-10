import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient } from './data-client'
import { CURRENT_RECORD_ID_POLICY } from './record-id-policy'
import {
  SHEET_RECORD_MAPPING_FORMAT,
  parseSheetRecordMapping,
  previewSheetRecordMapping,
  rejectInferredSheetRecordMapping,
  validateSheetRecordBatch,
} from './sheet-record-mapping'

const TITLE_COL = '10000000-0000-4000-8000-000000000001'
const NOTE_COL = '10000000-0000-4000-8000-000000000002'
const TYPE_COL = '10000000-0000-4000-8000-000000000003'
const REF_COL = '10000000-0000-4000-8000-000000000004'
const SAMPLE = '11111111-1111-4111-8111-111111111111'

const mapping = parseSheetRecordMapping({
  format: SHEET_RECORD_MAPPING_FORMAT,
  modelKey: 'sample',
  matchKey: 'identifier',
  recordIdPolicy: CURRENT_RECORD_ID_POLICY,
  columns: [
    { columnId: TITLE_COL, sourceKind: 'declared', target: { kind: 'title' } },
    {
      columnId: NOTE_COL,
      sourceKind: 'bound',
      target: { kind: 'model-field', fieldName: 'note' },
    },
    {
      columnId: TYPE_COL,
      sourceKind: 'bound',
      target: { kind: 'constant', fieldName: 'sample_class', value: 'harvest' },
    },
    {
      columnId: REF_COL,
      sourceKind: 'bound',
      target: { kind: 'model-field', fieldName: 'parent' },
    },
  ],
})

const fields = [
  {
    fieldName: 'note',
    logicalType: 'text' as const,
    nullable: false,
    lifecycle: 'active' as const,
  },
  {
    fieldName: 'sample_class',
    logicalType: 'category' as const,
    nullable: false,
    lifecycle: 'active' as const,
    categoryKeys: ['harvest'],
  },
  {
    fieldName: 'parent',
    logicalType: 'reference' as const,
    nullable: true,
    lifecycle: 'active' as const,
  },
]

describe('Sheet Record mapping', () => {
  it('requires explicit column IDs and refuses label inference', () => {
    expect(
      rejectInferredSheetRecordMapping({
        label: 'Note',
        fieldName: 'note',
      }).code,
    ).toBe('inferred-label')
    expect(() =>
      parseSheetRecordMapping({
        ...mapping,
        columns: [
          {
            columnId: TITLE_COL,
            sourceKind: 'declared',
            target: { kind: 'model-field', fieldName: 'note' },
          },
          {
            columnId: NOTE_COL,
            sourceKind: 'bound',
            target: { kind: 'model-field', fieldName: 'note' },
          },
        ],
      }),
    ).toThrow(/at most once/)
  })

  it('previews create, match, missing, incompatible, quantity and duplicate rows', () => {
    const rows = previewSheetRecordMapping({
      mapping,
      fields,
      rows: [
        {
          rowKey: 'row-create',
          matchIdentifier: null,
          values: {
            [TITLE_COL]: 'LV harvest',
            [NOTE_COL]: 'cold',
            [REF_COL]: SAMPLE,
          },
        },
        {
          rowKey: 'row-match',
          matchIdentifier: 'SMP-2026-0001',
          values: {
            [TITLE_COL]: 'Existing',
            [NOTE_COL]: 'cold',
          },
        },
        {
          rowKey: 'row-missing',
          values: { [TITLE_COL]: 'Missing note' },
        },
        {
          rowKey: 'row-type',
          values: { [TITLE_COL]: 'Bad type', [NOTE_COL]: 12 },
        },
        {
          rowKey: 'row-ref',
          values: {
            [TITLE_COL]: 'Bad ref',
            [NOTE_COL]: 'cold',
            [REF_COL]: 'SMP-2026-0001',
          },
        },
        {
          rowKey: 'dup-a',
          matchIdentifier: 'SMP-2026-0099',
          values: { [TITLE_COL]: 'Dup A', [NOTE_COL]: 'cold' },
        },
        {
          rowKey: 'dup-b',
          matchIdentifier: 'SMP-2026-0099',
          values: { [TITLE_COL]: 'Dup B', [NOTE_COL]: 'cold' },
        },
      ],
    })

    expect(rows[0]).toMatchObject({
      classification: 'create',
      title: 'LV harvest',
      values: { note: 'cold', sample_class: 'harvest', parent: SAMPLE },
    })
    expect(rows[1].classification).toBe('match')
    expect(rows[2].errors.map((error) => error.code)).toContain(
      'required-value',
    )
    expect(rows[3].errors.map((error) => error.code)).toContain(
      'incompatible-type',
    )
    expect(rows[4].errors.map((error) => error.code)).toContain(
      'invalid-reference',
    )
    expect(rows[5].errors.map((error) => error.code)).toContain(
      'duplicate-input-row',
    )
    expect(rows[6].classification).toBe('invalid')
  })

  it('rejects quantity objects that would imply conversion', () => {
    const preview = previewSheetRecordMapping({
      mapping: parseSheetRecordMapping({
        format: SHEET_RECORD_MAPPING_FORMAT,
        modelKey: 'sample',
        matchKey: 'none',
        recordIdPolicy: CURRENT_RECORD_ID_POLICY,
        columns: [
          {
            columnId: TITLE_COL,
            sourceKind: 'declared',
            target: { kind: 'title' },
          },
          {
            columnId: NOTE_COL,
            sourceKind: 'bound',
            target: { kind: 'model-field', fieldName: 'viability' },
          },
        ],
      }),
      fields: [
        {
          fieldName: 'viability',
          logicalType: 'decimal',
          nullable: false,
          lifecycle: 'active',
          quantity: { storageUnit: '%' },
        },
      ],
      rows: [
        {
          rowKey: 'qty',
          values: {
            [TITLE_COL]: 'Qty',
            [NOTE_COL]: { value: 98, unit: 'fraction' },
          },
        },
      ],
    })

    expect(preview[0].errors[0].code).toBe('quantity-unconverted')
  })
})

describe('Sheet Record batch transport', () => {
  const input = { projectId: SAMPLE, modelKey: 'sample' }

  const refusal = {
    ok: false,
    mutated: false,
    rows: [
      {
        rowIndex: 1,
        rowKey: 'row',
        classification: 'invalid',
        recordId: null,
        errors: [
          {
            code: 'record_id_policy',
            fieldName: 'identifier',
            message: 'Model-generated identifiers required.',
          },
        ],
      },
    ],
  }

  it('preserves a server refusal and the original scientific values', async () => {
    const values = Object.defineProperty(
      {
        nested: Object.defineProperty({}, '__proto__', {
          value: { note: null },
          enumerable: true,
        }),
      },
      '__proto__',
      { value: 'scientific key', enumerable: true },
    )

    const rows = [
      {
        rowKey: 'row',
        operation: 'create',
        title: 'Sample',
        values,
      } satisfies Parameters<
        typeof validateSheetRecordBatch
      >[0]['rows'][number],
    ]

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(refusal))

    await expect(
      validateSheetRecordBatch({ ...input, rows }, createDataClient(fetchImpl)),
    ).resolves.toEqual(refusal)
    expect(fetchImpl.mock.calls[0][0]).toBe(
      '/api/db/rpc/validate_sheet_record_batch',
    )
    expect(
      JSON.parse(z.string().parse(fetchImpl.mock.calls[0][1]?.body)),
    ).toEqual({
      p_project_id: SAMPLE,
      p_model_key: 'sample',
      p_rows: rows,
    })
  })

  it.each([undefined, NaN, Infinity, () => 1, Symbol('value'), 1n])(
    'rejects raw non-JSON scientific values before HTTP: %s',
    async (value) => {
      const fetchImpl = vi.fn<typeof fetch>()

      const values = Object.defineProperty({}, '__proto__', {
        value: { nested: value },
        enumerable: true,
      })

      await expect(
        validateSheetRecordBatch(
          { ...input, rows: [{ rowKey: 'row', operation: 'create', values }] },
          createDataClient(fetchImpl),
        ),
      ).rejects.toThrow()
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it('preserves omission, null and server record-reference refusal semantics', async () => {
    const rows = [
      {
        rowKey: 'row',
        operation: 'link',
        recordId: 'not-a-uuid',
      } satisfies Parameters<
        typeof validateSheetRecordBatch
      >[0]['rows'][number],
    ]

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...refusal,
        rows: [
          {
            ...refusal.rows[0],
            errors: [{ code: 'not-uuid', message: 'Choose a Record UUID.' }],
          },
        ],
      }),
    )

    const result = await validateSheetRecordBatch(
      { ...input, rows },
      createDataClient(fetchImpl),
    )

    expect(result.rows[0].recordId).toBeNull()
    expect(result.rows[0].errors[0].code).toBe('not-uuid')
    expect(
      JSON.parse(z.string().parse(fetchImpl.mock.calls[0][1]?.body)).p_rows,
    ).toEqual(rows)
  })

  it.each([
    null,
    {},
    { ...refusal, mutated: true },
    { ...refusal, rows: [{ ...refusal.rows[0], errors: [{}] }] },
  ])('rejects malformed responses: %j', async (body) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(body))

    await expect(
      validateSheetRecordBatch(
        { ...input, rows: [{ rowKey: 'row', operation: 'create' }] },
        createDataClient(fetchImpl),
      ),
    ).rejects.toThrow()
  })

  it('preserves HTTP refusal diagnostics', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { code: '42501', message: 'capability required: record.link' },
          { status: 403 },
        ),
      )

    await expect(
      validateSheetRecordBatch(
        { ...input, rows: [{ rowKey: 'row', operation: 'link' }] },
        createDataClient(fetchImpl),
      ),
    ).rejects.toMatchObject({
      code: '42501',
      status: 403,
      message: 'capability required: record.link',
    })
  })
})
