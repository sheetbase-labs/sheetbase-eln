/**
 * Registry parity and goldens.
 *
 * The registry is a pure re-point of declarations that previously lived in six
 * modules, so the valuable tests here are the ones that pin the *behaviour a
 * user can observe* — the default payload a new block starts with, and the
 * summary the conflict banner shows — plus the invariants the type system
 * cannot express: which types are editable, which render wide, and which the
 * insert menu offers.
 *
 * Type-level completeness (every `BlockType` has a descriptor) is enforced by
 * `Record<BlockType, BlockDescriptor>` and is deliberately not re-asserted.
 */

import { describe, expect, it } from 'vitest'

import {
  BLOCK_PICKER_GROUPS,
  BLOCK_PICKER_OPTIONS,
  BLOCK_TYPES,
  defaultPayloadFor,
  editableBlockTypes,
  isBlockType,
  isEditableBlockType,
  summarizeBlockPayload,
} from './registry'

describe('block allow-list', () => {
  it('recognises the declared types and rejects anything else', () => {
    for (const type of BLOCK_TYPES) {
      expect(isBlockType(type)).toBe(true)
    }
    // Decision 0015: an unknown future type is reported as unsupported and
    // preserved as a readable placeholder, never rewritten.
    expect(isBlockType('quantum_state')).toBe(false)
    expect(isBlockType('')).toBe(false)
    expect(isBlockType('constructor')).toBe(false)
  })
})

describe('editable types', () => {
  /**
   * A4 closed the gap for `callout` and `metric`. The static `table` block is
   * still read-only, and `sheet` is rendered by the document rather than the
   * editor switch: pinning the set means an editor arriving for either has to
   * be acknowledged rather than passing silently.
   */
  it('is exactly the types the editor switch handles', () => {
    expect(editableBlockTypes()).toEqual([
      'rich_text',
      'checklist',
      'linked_record',
      'callout',
      'chart',
      'analysis',
      'plate_map',
      'file',
      'metric',
      'procedure_step',
      'protocol_reference',
      'materials',
      'pipeline_output',
      'signature_request',
      'corrective_actions',
      'conclusion',
      'dataset_import',
    ])
    for (const type of ['table', 'sheet'] as const) {
      expect(isEditableBlockType(type)).toBe(false)
    }
    expect(isEditableBlockType('quantum_state')).toBe(false)
  })
})

describe('insert catalogue', () => {
  it('offers only real block types, plus the shared-sheet affordance', () => {
    // `sheet_shared` is not a stored type: it resolves to a `sheet` block bound
    // to an existing instance, so it is the one permitted alias.
    const aliases = BLOCK_PICKER_OPTIONS.map((o) => o.type).filter(
      (type) => !isBlockType(type),
    )
    expect(aliases).toEqual(['sheet_shared'])
  })

  it('names no group the menu does not declare', () => {
    const groupIds = BLOCK_PICKER_GROUPS.map((g) => g.id)
    for (const option of BLOCK_PICKER_OPTIONS) {
      expect(groupIds).toContain(option.group)
    }
  })

  it('gives every entry a label, a description and at least one alias', () => {
    for (const option of BLOCK_PICKER_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(option.description.length).toBeGreaterThan(0)
      expect(option.aliases.length).toBeGreaterThan(0)
    }
  })

  it('declares each insertable kind once', () => {
    const types = BLOCK_PICKER_OPTIONS.map((o) => o.type)
    expect(new Set(types).size).toBe(types.length)
  })
})

describe('default payloads', () => {
  it('starts rich_text, checklist and linked_record with a valid draft', () => {
    expect(defaultPayloadFor('rich_text')).toEqual({
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    expect(defaultPayloadFor('checklist')).toEqual({
      items: [{ text: '', checked: false }],
    })
    expect(defaultPayloadFor('linked_record')).toEqual({
      targetKind: 'experiment',
      targetIdentifier: '',
      linkType: 'general',
      label: '',
    })
    expect(defaultPayloadFor('materials')).toEqual({ items: [] })
  })

  it('leaves the draft-and-pick types empty so their editor opens immediately', () => {
    for (const type of [
      'chart',
      'plate_map',
      'analysis',
      'sheet',
      'file',
      'callout',
      'table',
      'metric',
      'procedure_step',
      'protocol_reference',
      'pipeline_output',
      'dataset_import',
    ] as const) {
      expect(defaultPayloadFor(type)).toEqual({})
    }
  })

  it('starts the sign-and-attach blocks without a signer or an action', () => {
    expect(defaultPayloadFor('signature_request')).toEqual({
      requestedUserId: null,
      requestedUserName: null,
      meaning: 'reviewed',
      note: '',
    })
    expect(defaultPayloadFor('corrective_actions')).toEqual({ items: [] })
  })

  it('returns an empty draft for a type this build does not know', () => {
    expect(defaultPayloadFor('quantum_state')).toEqual({})
  })

  it('hands back a fresh object each time', () => {
    const first = defaultPayloadFor('checklist')
    first.items = []
    expect(defaultPayloadFor('checklist')).toEqual({
      items: [{ text: '', checked: false }],
    })
  })
})

describe('conflict summary', () => {
  it('reads prose as its plain text', () => {
    expect(
      summarizeBlockPayload('rich_text', {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Assay ran clean.' }],
            },
          ],
        },
      }),
    ).toBe('Assay ran clean.')
    expect(summarizeBlockPayload('rich_text', {})).toBe('(empty)')
  })

  it('reads a checklist as its ticked items', () => {
    expect(
      summarizeBlockPayload('checklist', {
        items: [
          { text: 'Weigh sample', checked: true },
          { text: 'Record mass', checked: false },
        ],
      }),
    ).toBe('[x] Weigh sample\n[ ] Record mass')
    expect(summarizeBlockPayload('checklist', { items: [] })).toBe('(no items)')
  })

  it('reads a record reference as its link', () => {
    expect(
      summarizeBlockPayload('linked_record', {
        linkType: 'sample',
        targetKind: 'sample',
        targetIdentifier: 'S-0142',
        label: 'Lot 7',
      }),
    ).toBe('sample: sample S-0142 — Lot 7')
  })

  it('reads a plate map as its title and well count', () => {
    expect(
      summarizeBlockPayload('plate_map', {
        title: 'Run 4',
        spec: { wells: [{}, {}] },
      }),
    ).toBe('Run 4 — 2 wells')
    expect(summarizeBlockPayload('plate_map', {})).toBe('Plate map — 0 wells')
  })

  it('marks a frozen analysis and names the pipeline run', () => {
    expect(summarizeBlockPayload('analysis', { title: 'Hill fit' })).toBe(
      'Hill fit',
    )
    expect(
      summarizeBlockPayload('analysis', { title: 'Hill fit', frozen: true }),
    ).toBe('Hill fit (frozen)')
    expect(
      summarizeBlockPayload('pipeline_output', {
        runId: '9f1c2b3d-0000-0000-0000-000000000000',
      }),
    ).toBe('Pipeline output — run 9f1c2b3d')
  })

  it('falls back to the JSON dump for types with no summary', () => {
    expect(summarizeBlockPayload('table', { columns: ['a'] })).toBe(
      JSON.stringify({ columns: ['a'] }, null, 2),
    )
    expect(summarizeBlockPayload('quantum_state', { a: 1 })).toBe(
      JSON.stringify({ a: 1 }, null, 2),
    )
  })
})
