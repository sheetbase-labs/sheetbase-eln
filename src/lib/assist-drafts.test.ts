/**
 * ASSIST-02 tests. Builders are deterministic and grounded: mapping
 * suggestions extend the exact-match kernel with confidence + reason and
 * chart proposals always pass the canonical validators. Discard is a pure
 * UI callback (panel test).
 */
import { describe, expect, it } from 'vitest'

import {
  applyMappingProposal,
  proposeChartSpec,
  suggestMappingProposal,
} from './assist-drafts'
import { validateChartSpec } from './chart-spec'
import type { ImportTargetField } from './import-mapping'

function targetField(
  overrides: Partial<ImportTargetField> = {},
): ImportTargetField {
  return {
    id: 'organism',
    key: 'organism',
    label: 'Organism',
    logicalType: 'text',
    nullable: false,
    kind: 'record-field',
    ...overrides,
  }
}

const DATASET_ID = '11111111-1111-4111-8111-111111111111'

describe('suggestMappingProposal', () => {
  const fields: ImportTargetField[] = [
    targetField(),
    targetField({
      id: 'sample-id',
      key: 'sample_id',
      label: 'Sample',
      logicalType: 'text',
      nullable: true,
    }),
  ]

  it('keeps exact matches exact, offers close matches with reasons, ignores the rest', () => {
    const proposal = suggestMappingProposal(
      ['Organism', 'sample_id', 'zzz_unmatched'],
      fields,
    )
    expect(proposal.kind).toBe('import_mapping')
    expect(proposal.suggestions[0]?.confidence).toBe('exact')
    expect(proposal.suggestions[0]?.mapping).toMatchObject({
      kind: 'field',
    })
    // 'sample_id' exact-matches the target key, so it stays exact; a
    // separator-variant header exercises the close path instead.
    const close = suggestMappingProposal(['sampleid'], fields)
    expect(close.suggestions[0]?.confidence).toBe('close')
    expect(close.suggestions[0]?.reason).toContain('separators or case')
    expect(proposal.suggestions[2]?.confidence).toBe('none')
    expect(proposal.suggestions[2]?.mapping.kind).toBe('ignore')
    expect(proposal.mappedCount).toBe(2)
    expect(proposal.ignoredCount).toBe(1)
  })

  it('is deterministic across runs', () => {
    const headers = ['Organism', 'Sample ID', 'notes!!']
    const first = suggestMappingProposal(headers, fields)
    const second = suggestMappingProposal(headers, fields)
    expect(second).toEqual(first)
  })

  it('projects back to the ordinary mapping the import path commits', () => {
    const proposal = suggestMappingProposal(['Organism'], fields)
    const mappings = applyMappingProposal(proposal)
    expect(mappings).toHaveLength(1)
    expect(mappings[0]).toMatchObject({ source: 'Organism', kind: 'field' })
  })
})

describe('proposeChartSpec', () => {
  const TEMP_ID = '22222222-2222-4222-8222-222222222222'
  const COND_ID = '33333333-3333-4333-8333-333333333333'
  it('proposes a valid histogram for a single measured field', () => {
    const proposal = proposeChartSpec({
      datasetId: DATASET_ID,
      fields: [
        { fieldId: TEMP_ID, label: 'Temperature', logicalType: 'number' },
      ],
    })
    expect(proposal?.spec.type).toBe('histogram')
    expect(validateChartSpec(proposal?.spec)).toEqual([])
  })

  it('proposes a valid bar chart for categorical x + numeric y', () => {
    const proposal = proposeChartSpec({
      datasetId: DATASET_ID,
      fields: [
        { fieldId: TEMP_ID, label: 'Temperature', logicalType: 'number' },
        { fieldId: COND_ID, label: 'Condition', logicalType: 'text' },
      ],
    })
    expect(proposal?.spec.type).toBe('bar')
    expect(validateChartSpec(proposal?.spec)).toEqual([])
  })

  it('returns null when no valid spec can be grounded', () => {
    expect(proposeChartSpec({ datasetId: 'not-a-uuid', fields: [] })).toBeNull()
    expect(proposeChartSpec({ datasetId: DATASET_ID, fields: [] })).toBeNull()
    // Non-UUID field ids cannot bind (validateChartSpec rejects them).
    expect(
      proposeChartSpec({
        datasetId: DATASET_ID,
        fields: [
          { fieldId: 'f-temp', label: 'Temperature', logicalType: 'number' },
        ],
      }),
    ).toBeNull()
  })
})
