import { describe, expect, it } from 'vitest'

import { BLOCK_TYPES } from './registry'
import { isBlockPayloadValid, validateBlock } from './index'

describe('block payload validation (ELN-002)', () => {
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
    const samples: Record<string, unknown> = {
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
      signature_request: {
        requestedUserId: null,
        requestedUserName: 'Ada Lovelace',
        meaning: 'reviewed',
        note: 'Please review the clarification runs.',
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
    expect(result.errors?.map((error) => error.field)).toEqual([
      'verdict',
      'basis',
    ])
  })
})
