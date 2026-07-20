import { describe, expect, it } from 'vitest'

import {
  KNOWN_BLOCK_TYPES,
  PAYLOAD_SCHEMA_VERSION,
  isBlockPayloadValid,
  validateBlock,
} from './index'

describe('block payload validation (ELN-002)', () => {
  it('accepts a valid heading payload', () => {
    const r = validateBlock({
      type: 'heading',
      payload: { level: 2, text: 'Methods' },
    })
    expect(r.ok).toBe(true)
    expect(r.payloadSchemaVersion).toBe(PAYLOAD_SCHEMA_VERSION)
  })

  it('rejects a heading with an out-of-range level', () => {
    const r = validateBlock({
      type: 'heading',
      payload: { level: 7, text: 'Methods' },
    })
    expect(r.ok).toBe(false)
    expect(r.errors[0]?.field).toBe('level')
  })

  it('rejects a heading with empty text', () => {
    const r = validateBlock({
      type: 'heading',
      payload: { level: 2, text: '   ' },
    })
    expect(r.ok).toBe(false)
    expect(r.errors[0]?.code).toBe('missing_required_field')
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
    expect(
      validateBlock({
        type: 'rich_text',
        payload: {
          doc: {
            type: 'doc',
            content: [{ type: 'heading', attrs: { level: 1 } }],
          },
        },
      }).ok,
    ).toBe(false)
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
      type: 'heading',
      payload: { level: 2, text: 'x' },
      payloadSchemaVersion: 99,
    })
    expect(r.ok).toBe(false)
    expect(r.errors[0]?.code).toBe('unsupported_payload_schema_version')
  })

  it('rejects a non-object payload', () => {
    const r = validateBlock({ type: 'heading', payload: 'not an object' })
    expect(r.ok).toBe(false)
    expect(r.errors[0]?.code).toBe('invalid_payload_shape')
  })

  it('validates every known block type with a representative payload', () => {
    const samples: Record<string, unknown> = {
      heading: { level: 2, text: 'Methods' },
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
      list: { items: ['DPBS', 'TaqMan kit'], ordered: false },
      callout: { text: 'Include NTC.', variant: 'warning' },
      table: { columns: ['Time', 'Value'], rows: [[0, 1.2]] },
      sheet: { tableId: '0198d970-e266-4000-8000-000000000001' },
      chart: {
        title: 'Assay',
        spec: '{"type":"line"}',
        provenance: 'Analysis Studio',
      },
      plate_map: { wells: [{ row: 0, col: 0, value: 0.5 }] },
      file: { name: 'data.xlsx', size: 1024, mime: 'application/vnd.ms-excel' },
      metric: { label: 'Titer', value: 2.31e7, unit: 'copies/mL' },
      procedure_step: { text: 'Prepare standards.', stepNumber: 1 },
    }
    for (const type of KNOWN_BLOCK_TYPES) {
      expect(validateBlock({ type, payload: samples[type] }).ok).toBe(true)
    }
  })
})
