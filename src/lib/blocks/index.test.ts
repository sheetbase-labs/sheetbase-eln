import { describe, expect, it } from 'vitest'

import { BLOCK_TYPES } from './registry'
import {
  EMPTY_RICH_TEXT_PAYLOAD,
  isBlockPayloadValid,
  isEmptyRichText,
  validateBlock,
} from './index'

describe('block payload validation (ELN-002)', () => {
  it('accepts empty, uploaded and committed import blocks without a title', () => {
    const fileId = crypto.randomUUID()
    const datasetId = crypto.randomUUID()

    for (const payload of [
      {},
      { fileId, datasetId },
      {
        fileId,
        datasetId,
        search: {
          step: 'check',
          map: 'a:b',
          sheet: 'Sheet 1',
          units: '',
          parser: 'csv',
          instrument: '',
        },
      },
      {
        fileId,
        datasetId,
        sheetName: 'Sheet 1',
        importId: crypto.randomUUID(),
        datasetVersionId: crypto.randomUUID(),
      },
    ]) {
      expect(validateBlock({ type: 'dataset_import', payload }).ok).toBe(true)
    }
  })

  it('rejects partial and malformed import pins', () => {
    const fileId = crypto.randomUUID()
    const datasetId = crypto.randomUUID()

    for (const payload of [
      null,
      [],
      { fileId },
      { datasetId },
      { fileId: null, datasetId },
      { fileId, datasetId, importId: crypto.randomUUID() },
      { fileId, datasetId, datasetVersionId: crypto.randomUUID() },
      { fileId, datasetId, sheetName: 2 },
      { sheetName: 'Sheet 1' },
      { fileId: 'not-a-uuid', datasetId },
      { fileId, datasetId, search: { dataset: datasetId } },
      { fileId, datasetId, search: { step: 'upload' } },
      { fileId, datasetId, search: { map: {} } },
      {
        fileId,
        datasetId,
        importId: crypto.randomUUID(),
        datasetVersionId: crypto.randomUUID(),
        search: {},
      },
    ]) {
      expect(validateBlock({ type: 'dataset_import', payload }).ok).toBe(false)
    }
  })

  it('accepts a valid rich_text payload', () => {
    expect(
      isBlockPayloadValid({
        type: 'rich_text',
        payload: {
          doc: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'Materials' }],
              },
              {
                type: 'heading',
                attrs: { level: 3 },
                content: [{ type: 'text', text: 'Reagents' }],
              },
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Samples were held at 4 degrees C.' },
                ],
              },
            ],
          },
        },
      }),
    ).toBe(true)
  })

  it('accepts the complete supported rich-text v1 feature set', () => {
    expect(
      isBlockPayloadValid({
        type: 'rich_text',
        payload: {
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'H2O x2 assay',
                    marks: [
                      { type: 'bold' },
                      { type: 'italic' },
                      {
                        type: 'link',
                        attrs: {
                          href: 'https://example.test/result',
                          target: null,
                          rel: null,
                          class: null,
                        },
                      },
                    ],
                  },
                  {
                    type: 'text',
                    text: '2',
                    marks: [{ type: 'subscript' }],
                  },
                  {
                    type: 'text',
                    text: '2',
                    marks: [{ type: 'superscript' }],
                  },
                  {
                    type: 'text',
                    text: 'code',
                    marks: [{ type: 'code' }],
                  },
                ],
              },
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph' }],
                  },
                ],
              },
              {
                type: 'orderedList',
                attrs: { start: 2, type: null },
                content: [
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph' }],
                  },
                ],
              },
            ],
          },
        },
      }),
    ).toBe(true)
  })

  it('rejects rich text outside the supported v1 document schema', () => {
    const r = validateBlock({ type: 'rich_text', payload: {} })
    expect(r.ok).toBe(false)
    expect(r.errors[0]?.field).toBe('doc')

    for (const level of [1, 4]) {
      expect(
        validateBlock({
          type: 'rich_text',
          payload: {
            doc: {
              type: 'doc',
              content: [{ type: 'heading', attrs: { level } }],
            },
          },
        }).ok,
      ).toBe(false)
    }

    expect(
      validateBlock({
        type: 'rich_text',
        payload: {
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'unsafe',
                    marks: [
                      { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      }).ok,
    ).toBe(false)
  })

  it('accepts a valid checklist payload', () => {
    expect(
      isBlockPayloadValid({
        type: 'checklist',
        payload: {
          items: [
            { text: 'Prepare standards', checked: true },
            { text: 'Run qPCR', checked: false },
          ],
        },
      }),
    ).toBe(true)
  })

  it('rejects a checklist item with a non-boolean checked', () => {
    const r = validateBlock({
      type: 'checklist',
      payload: { items: [{ text: 'x', checked: 'yes' }] },
    })

    expect(r.ok).toBe(false)
    expect(r.errors[0]?.field).toBe('items[0].checked')
  })

  it('accepts a valid linked_record payload', () => {
    expect(
      isBlockPayloadValid({
        type: 'linked_record',
        payload: {
          targetKind: 'sample',
          targetIdentifier: 'SMP-2025-0001',
          linkType: 'sample',
          label: 'LVW-CAR-T Lot A',
        },
      }),
    ).toBe(true)
  })

  it('rejects a linked_record with missing linkType', () => {
    const r = validateBlock({
      type: 'linked_record',
      payload: { targetKind: 'sample', targetIdentifier: 'SMP-1' },
    })

    expect(r.ok).toBe(false)
    expect(r.errors[0]?.field).toBe('linkType')
  })

  it('reports unknown_block_type for a future type', () => {
    const r = validateBlock({
      type: 'ai_summary',
      payload: { text: 'something' },
    })

    expect(r.ok).toBe(false)
    expect(r.errors[0]?.code).toBe('unknown_block_type')
  })

  it('rejects an unsupported payload schema version', () => {
    const r = validateBlock({
      type: 'rich_text',
      payload: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      payloadSchemaVersion: 99,
    })

    expect(r.ok).toBe(false)
    expect(r.errors[0]?.code).toBe('unsupported_payload_schema_version')
  })

  it('rejects a non-object payload', () => {
    const r = validateBlock({ type: 'rich_text', payload: 'not an object' })
    expect(r.ok).toBe(false)
    expect(r.errors[0]?.code).toBe('invalid_payload_shape')
  })

  it('validates every known block type with a representative payload', () => {
    const samples = {
      rich_text: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Body text.' }],
            },
          ],
        },
      },
      checklist: { items: [{ text: 'x', checked: true }] },
      structure: { molfile: '', title: 'Aspirin', formula: 'C9H8O4' },
      code_cell: {
        language: 'sql',
        source: 'select 1',
        inputs: [
          {
            alias: 'samples',
            datasetVersionId: '11111111-1111-4111-8111-111111111111',
          },
        ],
      },
      reaction: {
        drawing: '',
        rows: [
          { id: 'a', role: 'reactant', name: 'Salicylic acid', mw: 138.12 },
        ],
      },
      sequence: {
        name: 'pUC19',
        molecule: 'dna',
        topology: 'circular',
        residues: 'ATGCATGCATGC',
        features: [],
      },
      linked_record: {
        targetKind: 'sample',
        targetIdentifier: 'SMP-1',
        linkType: 'sample',
      },
      callout: { text: 'Include NTC.', variant: 'warning' },
      conclusion: {
        text: 'Titre fell below spec by day 14.',
        verdict: 'supported',
        basis: 'Welch t-test, p = 0.003',
      },
      table: { columns: ['Time', 'Value'], rows: [[0, 1.2]] },
      sheet: { instanceId: '0198d970-e266-4000-8000-000000000001' },
      chart: {
        title: 'Assay',
        spec: {
          specVersion: 1,
          type: 'line',
          datasets: [{ datasetId: '0198d970-e266-4000-8000-000000000001' }],
          fields: {
            x: {
              fieldId: '0198d970-e266-4000-8000-000000000002',
            },
            y: {
              fieldId: '0198d970-e266-4000-8000-000000000003',
            },
            series: null,
            color: null,
            size: null,
            facet: null,
          },
          filters: [],
          transformations: [],
          typeParams: {},
          display: {
            axes: {
              x: { label: 'Time (days)', scale: 'linear', unit: 'd' },
              y: { label: 'GCN per mL', scale: 'log', unit: 'copies/mL' },
            },
            series: [],
            legend: { visible: true },
            annotations: [],
          },
          overlays: { errorBars: null },
        },
        provenance: 'Analysis Studio',
      },
      plugin: { plugin: 'dilution', block: 'dilution' },
      analysis: {
        title: 'Recovery slope',
        definitionId: '0198d970-e266-4000-8000-000000000009',
        frozen: null,
      },
      plate_map: {
        title: 'qPCR titration plate',
        spec: {
          specVersion: 1,
          format: '96_well',
          rows: 8,
          cols: 12,
          wells: [
            {
              wellCode: 'A1',
              row: 0,
              col: 0,
              role: 'positive_control',
            },
            {
              wellCode: 'A2',
              row: 0,
              col: 1,
              role: 'sample',
              sampleRef: {
                recordId: '0198d970-e266-4000-8000-000000000012',
                identifier: 'SMP-2026-0001',
                title: 'Reference sample',
              },
              replicate: 1,
              volume: { value: 20, unit: 'µL' },
            },
          ],
          validation: {
            requiredRoles: ['positive_control'],
            volumeMin: 5,
            volumeMax: 50,
            volumeUnit: 'µL',
          },
        },
        provenance: 'Titration assay layout',
      },
      file: {
        fileRecordId: '0198d970-e266-4000-8000-000000000020',
        fileIdentifier: 'FILE-2026-0001',
        displayName: 'data.xlsx',
        mediaType: 'application/vnd.ms-excel',
        byteSize: 1024,
      },
      metric: { label: 'Titer', value: 2.31e7, unit: 'copies/mL' },
      procedure_step: { text: 'Prepare standards.', stepNumber: 1 },
      protocol_reference: {
        protocolRecordId: '0198d970-e266-4000-8000-000000000010',
        protocolIdentifier: 'PRT-2026-0001',
        protocolTitle: 'Titration Assay',
        protocolRevisionId: '0198d970-e266-4000-8000-000000000011',
        version: '1.2',
        approvalStatus: 'active',
        pinnedAt: '2026-07-21T12:00:00Z',
        pinnedByUserId: 'user-1',
      },
      materials: {
        items: [
          {
            id: 'material-1',
            materialRecordId: '0198d970-e266-4000-8000-000000000012',
            kind: 'sample',
            identifier: 'SMP-2026-0001',
            title: 'Reference sample',
            quantity: 25,
            unit: { code: 'uL', symbol: 'µL', quantityKind: 'volume' },
            observedAt: '2026-07-21T12:00:00Z',
          },
        ],
      },
      pipeline_output: {
        runId: '0198d970-e266-4000-8000-000000000010',
        datasetId: '0198d970-e266-4000-8000-000000000020',
        datasetVersionId: '0198d970-e266-4000-8000-000000000021',
        label: 'scaled measurements',
      },
      dataset_import: {},
      signature_request: {
        requestedUserId: null,
        requestedUserName: 'Ada Lovelace',
        meaning: 'reviewed',
        note: 'Please review the clarification runs.',
      },
      gate: {
        mode: 'warn',
        conditions: [{ kind: 'samples_linked', min: 2 }],
      },
      corrective_actions: {
        items: [
          {
            id: 'CAPA-1',
            action: 'Repeat the reading at 1:5 dilution',
            ownerUserId: null,
            ownerName: 'Gareth P.',
            due: '2026-10-03',
            status: 'in-progress',
          },
        ],
      },
    }

    for (const type of BLOCK_TYPES) {
      expect(validateBlock({ type, payload: samples[type] }).ok).toBe(true)
    }
  })

  it('checks the series of a quality control gate condition', () => {
    const gate = (condition: { kind: string; seriesId?: string }) =>
      validateBlock({
        type: 'gate',
        payload: { mode: 'block', conditions: [condition] },
      }).ok

    expect(gate({ kind: 'qc_in_control' })).toBe(true)
    expect(
      gate({
        kind: 'qc_in_control',
        seriesId: '0198d970-e266-4000-8000-000000000030',
      }),
    ).toBe(true)
    expect(gate({ kind: 'qc_in_control', seriesId: 'nope' })).toBe(false)
  })

  it('checks the plugin of a plugin gate condition', () => {
    const gate = (condition: { kind: string; extensionKey?: string }) =>
      validateBlock({
        type: 'gate',
        payload: { mode: 'block', conditions: [condition] },
      }).ok

    expect(gate({ kind: 'plugin_flag', extensionKey: 'lab-rules' })).toBe(true)
    expect(gate({ kind: 'plugin_flag' })).toBe(false)
    expect(gate({ kind: 'plugin_flag', extensionKey: 'Lab Rules' })).toBe(false)
  })

  it('validates execution state separately from a reusable procedure definition', () => {
    expect(
      validateBlock({
        type: 'procedure_step',
        payload: {
          text: 'Read the plate.',
          stepNumber: 2,
          sourceProtocolRevisionId: '0198d970-e266-4000-8000-000000000011',
          sourceStepBlockId: '0198d970-e266-4000-8000-000000000013',
          completed: true,
          note: 'Read at 450 nm.',
          completedAt: '2026-07-21T12:30:00Z',
          completedByUserId: 'user-1',
        },
      }).ok,
    ).toBe(true)
  })

  it('rejects invalid material quantities, units, and duplicate item ids', () => {
    const result = validateBlock({
      type: 'materials',
      payload: {
        items: [
          {
            id: 'same',
            materialRecordId: '0198d970-e266-4000-8000-000000000012',
            kind: 'sample',
            identifier: 'SMP-2026-0001',
            title: 'Sample',
            quantity: 0,
            unit: { code: '', symbol: '' },
            observedAt: '2026-07-21T12:00:00Z',
          },
          {
            id: 'same',
            materialRecordId: '0198d970-e266-4000-8000-000000000012',
            kind: 'sample',
            identifier: 'SMP-2026-0001',
            title: 'Sample',
            quantity: 1,
            unit: { code: 'uL', symbol: 'µL' },
            observedAt: '2026-07-21T12:00:00Z',
          },
        ],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.field)).toEqual(
      expect.arrayContaining([
        'items[0].quantity',
        'items[0].unit',
        'items[1].id',
      ]),
    )
  })

  it('accepts a canonical Sheet Instance payload and rejects mixed identities', () => {
    expect(
      isBlockPayloadValid({
        type: 'sheet',
        payload: { instanceId: '0198d970-e266-4000-8000-000000000001' },
      }),
    ).toBe(true)
    expect(
      isBlockPayloadValid({
        type: 'sheet',
        payload: { datasetId: '0198d970-e266-4000-8000-000000000001' },
      }),
    ).toBe(false)
    expect(
      isBlockPayloadValid({
        type: 'sheet',
        payload: {
          instanceId: '0198d970-e266-4000-8000-000000000001',
          datasetId: '0198d970-e266-4000-8000-000000000002',
        },
      }),
    ).toBe(false)
    expect(
      isBlockPayloadValid({
        type: 'sheet',
        payload: {},
      }),
    ).toBe(false)
  })
})

describe('conclusion block payload', () => {
  it('accepts an empty draft and each verdict', () => {
    expect(isBlockPayloadValid({ type: 'conclusion', payload: {} })).toBe(true)

    for (const verdict of ['supported', 'not_supported', 'inconclusive'])
      expect(
        isBlockPayloadValid({
          type: 'conclusion',
          payload: { text: 'x', verdict },
        }),
      ).toBe(true)
  })

  it('rejects a verdict outside the vocabulary and a non-string basis', () => {
    const result = validateBlock({
      type: 'conclusion',
      payload: { text: 'x', verdict: 'proven', basis: 3 },
    })

    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.field)).toEqual([
      'verdict',
      'basis',
    ])
  })
})

describe('empty rich text', () => {
  it('is an empty paragraph, and nothing with text in it', () => {
    expect(isEmptyRichText(EMPTY_RICH_TEXT_PAYLOAD)).toBe(true)
    expect(
      isEmptyRichText({
        doc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Thawed' }] },
          ],
        },
      }),
    ).toBe(false)
    expect(
      isEmptyRichText({
        doc: {
          type: 'doc',
          content: [{ type: 'heading', attrs: { level: 2 } }],
        },
      }),
    ).toBe(false)
    expect(isEmptyRichText(null)).toBe(false)
  })
})

describe('code cell payloads', () => {
  const version = '11111111-1111-4111-8111-111111111111'
  it('accepts an empty draft and refuses what the cell cannot run', () => {
    expect(validateBlock({ type: 'code_cell', payload: {} }).ok).toBe(true)

    expect(
      validateBlock({ type: 'code_cell', payload: { language: 'ruby' } }).ok,
    ).toBe(false)
    expect(
      validateBlock({
        type: 'code_cell',
        payload: { source: 'x'.repeat(50_001) },
      }).ok,
    ).toBe(false)
    expect(
      validateBlock({
        type: 'code_cell',
        payload: { inputs: [{ alias: '1bad', datasetVersionId: version }] },
      }).ok,
    ).toBe(false)
    expect(
      validateBlock({
        type: 'code_cell',
        payload: {
          inputs: [
            { alias: 'a', datasetVersionId: version },
            { alias: 'a', datasetVersionId: version },
          ],
        },
      }).ok,
    ).toBe(false)
    expect(
      validateBlock({
        type: 'code_cell',
        payload: { inputs: [{ alias: 'a', datasetVersionId: 'nope' }] },
      }).ok,
    ).toBe(false)
    expect(
      validateBlock({
        type: 'code_cell',
        payload: {
          output: { runId: 'x', rows: Array.from({ length: 101 }, () => ({})) },
        },
      }).ok,
    ).toBe(false)
  })
})

describe('raw block validation contracts', () => {
  it('keeps finite positive material quantities and native repeated quantity reads', () => {
    const material = {
      id: 'material-1',
      materialRecordId: '11111111-1111-4111-8111-111111111111',
      kind: 'sample',
      identifier: 'SMP-1',
      title: 'Observed sample',
      unit: { code: 'uL', symbol: 'µL' },
      observedAt: '2026-07-21T12:00:00Z',
    }

    for (const quantity of [Number.MIN_VALUE, Number.MAX_VALUE]) {
      expect(
        validateBlock({
          type: 'materials',
          payload: { items: [{ ...material, quantity }] },
        }).ok,
      ).toBe(true)
    }

    for (const quantity of [-0, 0, -1, NaN, Infinity, -Infinity, '1', 1n]) {
      expect(
        validateBlock({
          type: 'materials',
          payload: { items: [{ ...material, quantity }] },
        }).errors,
      ).toEqual([
        {
          code: 'invalid_field_value',
          field: 'items[0].quantity',
          message: 'quantity must be a positive finite number',
        },
      ])
    }

    let reads = 0

    const changing = {
      ...material,
      get quantity() {
        reads += 1

        return reads === 1 ? Infinity : 1
      },
    }

    expect(
      validateBlock({ type: 'materials', payload: { items: [changing] } }).ok,
    ).toBe(true)
    expect(reads).toBe(3)
  })

  it('retains native metric and table values without reading or coercing them', () => {
    const refusingValue = {
      get toJSON() {
        throw new Error('must not serialize scientific values')
      },
      [Symbol.toPrimitive]() {
        throw new Error('must not coerce scientific values')
      },
    }

    for (const value of [
      NaN,
      Infinity,
      -Infinity,
      -0,
      1n,
      Symbol('raw'),
      refusingValue,
    ]) {
      expect(
        validateBlock({
          type: 'metric',
          payload: { label: 'Native value', value },
        }),
      ).toEqual({
        ok: true,
        type: 'metric',
        payloadSchemaVersion: 1,
        errors: [],
      })
      expect(
        validateBlock({
          type: 'table',
          payload: { columns: ['Observed'], rows: [[value]] },
        }).ok,
      ).toBe(true)
    }
  })

  it('keeps inherited metric fields and the original property read order', () => {
    const reads: string[] = []

    class NativeMetric {
      get label() {
        reads.push('label')

        return 'Titer'
      }
      get value() {
        reads.push('value')

        return NaN
      }
      get unit() {
        reads.push('unit')

        return undefined
      }
      get provenance() {
        reads.push('provenance')

        return undefined
      }
    }

    const payload = new NativeMetric()

    expect(validateBlock({ type: 'metric', payload }).ok).toBe(true)
    expect(reads).toEqual(['label', 'value', 'value', 'unit', 'provenance'])
    expect(Object.keys(payload)).toEqual([])
  })

  it('retains native integer bounds and duration diagnostics', () => {
    for (const stepNumber of [-1, -0, 1e20]) {
      expect(
        validateBlock({
          type: 'procedure_step',
          payload: { text: 'Read', stepNumber },
        }).ok,
      ).toBe(true)
    }

    for (const durationSeconds of [1, 604_800]) {
      expect(
        validateBlock({
          type: 'procedure_step',
          payload: { text: 'Read', durationSeconds },
        }).ok,
      ).toBe(true)
    }

    for (const durationSeconds of [0, 604_801, NaN, Infinity]) {
      expect(
        validateBlock({
          type: 'procedure_step',
          payload: { text: 'Read', durationSeconds },
        }).errors,
      ).toEqual([
        {
          code: 'invalid_field_value',
          field: 'durationSeconds',
          message:
            'durationSeconds must be a whole number of seconds, up to a week',
        },
      ])
    }
  })

  it('preserves ordered diagnostics and does not inspect fields after early sheet refusal', () => {
    expect(
      validateBlock({ type: 'linked_record', payload: {} }).errors,
    ).toEqual([
      {
        code: 'missing_required_field',
        field: 'targetKind',
        message: 'targetKind is required',
      },
      {
        code: 'missing_required_field',
        field: 'targetIdentifier',
        message: 'targetIdentifier is required',
      },
      {
        code: 'missing_required_field',
        field: 'linkType',
        message: 'linkType is required',
      },
    ])
    expect(
      validateBlock({
        type: 'sheet',
        payload: {
          extra: true,
          get instanceId() {
            throw new Error('must not read')
          },
        },
      }).errors,
    ).toEqual([
      {
        code: 'invalid_field_value',
        message: 'sheet payload may only contain instanceId and presentation',
      },
    ])
  })

  it('retains gate-kind native coercion before strict per-kind checks', () => {
    const hints: string[] = []

    const kind = {
      [Symbol.toPrimitive](hint: string) {
        hints.push(hint)

        return 'step_done'
      },
    }

    expect(
      validateBlock({
        type: 'gate',
        payload: { mode: 'warn', conditions: [{ kind }] },
      }).ok,
    ).toBe(true)
    expect(hints).toEqual(['string'])
    const refusal = new Error('native kind refusal')

    expect(() =>
      validateBlock({
        type: 'gate',
        payload: {
          mode: 'warn',
          conditions: [
            {
              kind: {
                toString() {
                  throw refusal
                },
              },
            },
          ],
        },
      }),
    ).toThrow(refusal)
  })

  it('keeps repeated type-checked getter reads and native throws', () => {
    let sourceReads = 0
    const refusal = new Error('second source read')

    const payload = {
      get source() {
        sourceReads += 1

        if (sourceReads === 3) throw refusal

        return 'select 1'
      },
    }

    expect(() => validateBlock({ type: 'code_cell', payload })).toThrow(refusal)
    expect(sourceReads).toBe(3)
  })

  it('serializes plugin state only at the original state-size check', () => {
    const reads: string[] = []

    const payload = {
      get plugin() {
        reads.push('plugin')

        return 'sequence'
      },
      get block() {
        reads.push('block')

        return 'sequence'
      },
      get state() {
        reads.push('state')

        return {
          toJSON() {
            reads.push('toJSON')

            return 'ACGT'
          },
        }
      },
    }

    expect(validateBlock({ type: 'plugin', payload }).ok).toBe(true)
    expect(reads).toEqual([
      'plugin',
      'plugin',
      'block',
      'block',
      'state',
      'state',
      'toJSON',
    ])

    const cyclic = {
      get self() {
        return this
      },
    }

    expect(
      validateBlock({
        type: 'plugin',
        payload: { plugin: 'sequence', block: 'sequence', state: cyclic },
      }).errors,
    ).toEqual([
      {
        code: 'invalid_field_value',
        field: 'state',
        message: 'state must be data of at most 16 MiB',
      },
    ])
  })
})
