/**
 * ASSIST-02 tests. Builders are deterministic and grounded: text drafts
 * cite envelope/citation sources and validate as ordinary rich_text,
 * mapping suggestions extend the exact-match kernel with confidence +
 * reason, chart proposals always pass the canonical validators, and stub
 * phrasing stays marked assistance-only. Accept routes through the
 * canonical block insert; discard is a pure UI callback (panel test).
 */
import { describe, expect, it, vi } from 'vitest'

import type { AiContextEnvelope } from './ai-context'
import type { AiCitation } from './ai-retrieval'
import { ASSIST_STUB_MODEL } from './assist-explain'
import {
  acceptTextDraft,
  applyMappingProposal,
  buildTextDraftProposal,
  proposeChartSpec,
  stubPhraseDraft,
  suggestMappingProposal,
  summariseNotebookBlocks,
} from './assist-drafts'
import { validateBlock } from './blocks'
import { validateChartSpec } from './chart-spec'
import type { DataClient } from './data-client'
import type { ImportTargetField } from './import-mapping'

function citation(overrides: Partial<AiCitation> = {}): AiCitation {
  return {
    kind: 'record',
    stableId: 'rec-1',
    identifier: 'EXP-1',
    recordKind: 'experiment',
    title: 'Visible experiment',
    deepLink: '/records/rec-1',
    versionPin: null,
    freshness: 'live',
    archived: false,
    matchedContext: '<b>kinetics</b>',
    matchedField: 'block_text',
    rank: 1,
    ...overrides,
  }
}

function envelope(): AiContextEnvelope {
  return {
    version: 1,
    actor: { kind: 'user', id: 'user-1' },
    workspace: { id: 'ws-1', project: null },
    objects: [
      {
        kind: 'record',
        id: 'rec-1',
        title: 'Visible experiment',
        deepLink: '/records/rec-1',
        freshness: 'live',
        pins: [],
        sections: [
          { heading: 'Properties', body: 'organism: E. coli', truncated: false },
        ],
        truncated: false,
      },
    ],
    omissions: [],
    budgets: {
      applied: {
        maxObjects: 5,
        maxSectionsPerObject: 5,
        maxCharsPerSection: 100,
        maxCharsTotal: 1000,
        maxRowsPerDataset: 10,
      },
      usage: { chars: 10, sections: 1, rows: 0, objects: 1 },
    },
  }
}

function targetField(overrides: Partial<ImportTargetField> = {}): ImportTargetField {
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

describe('buildTextDraftProposal', () => {
  it('grounds the draft in envelope + citation sources with an insertable rich_text payload', () => {
    const proposal = buildTextDraftProposal({
      recordTitle: 'EXP-1',
      envelope: envelope(),
      citations: [citation()],
    })
    expect(proposal).not.toBeNull()
    expect(proposal?.kind).toBe('notebook_text')
    expect(proposal?.citations.length).toBeGreaterThan(0)
    expect(proposal?.draftText).toContain('EXP-1')
    // No new block types: the draft is ordinary rich_text and validates.
    expect(proposal?.block.type).toBe('rich_text')
    expect(
      validateBlock({
        type: proposal!.block.type,
        payload: proposal!.block.payload,
      }).ok,
    ).toBe(true)
    expect(proposal?.marking.assistance).toBe(true)
    expect(proposal?.marking.badge).toContain('Generated draft')
  })

  it('returns null when there are no sources rather than drafting ungrounded text', () => {
    expect(
      buildTextDraftProposal({ recordTitle: 'EXP-1' }),
    ).toBeNull()
    expect(
      buildTextDraftProposal({
        recordTitle: 'EXP-1',
        envelope: { ...envelope(), objects: [] },
        citations: [],
      }),
    ).toBeNull()
  })
})

describe('acceptTextDraft', () => {
  it('routes through the canonical insert_block with boundary validation', async () => {
    const proposal = buildTextDraftProposal({
      recordTitle: 'EXP-1',
      envelope: envelope(),
    })
    if (!proposal) throw new Error('fixture proposal must build')
    const rpc = vi.fn(async () => ({
      block: {
        id: 'b1',
        record_id: 'r1',
        type: 'rich_text',
        payload: proposal.block.payload,
        payload_schema_version: 1,
        order: 1,
        version: 1,
        created_at: '2026-07-19T00:00:00.000Z',
        updated_at: '2026-07-19T00:00:00.000Z',
      },
      structure_version: 2,
    }))
    const client = { rpc } as unknown as DataClient
    const result = await acceptTextDraft(client, {
      recordId: 'r1',
      proposal,
    })
    expect(rpc).toHaveBeenCalledWith('insert_block', expect.objectContaining({
      p_record_id: 'r1',
      p_type: 'rich_text',
    }))
    expect(result.block.id).toBe('b1')
  })
})

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
      fields: [{ fieldId: TEMP_ID, label: 'Temperature', logicalType: 'number' }],
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
        fields: [{ fieldId: 'f-temp', label: 'Temperature', logicalType: 'number' }],
      }),
    ).toBeNull()
  })
})

describe('stubPhraseDraft', () => {
  it('marks stub phrasing as assistance on the allowlisted model', async () => {
    const proposal = buildTextDraftProposal({
      recordTitle: 'EXP-1',
      envelope: envelope(),
    })
    if (!proposal) throw new Error('fixture proposal must build')
    const phrasing = await stubPhraseDraft(proposal)
    expect(phrasing.model).toBe(ASSIST_STUB_MODEL)
    expect(phrasing.assistance).toBe(true)
    expect(phrasing.text.length).toBeGreaterThan(0)
  })
})

describe('summariseNotebookBlocks', () => {
  function textBlock(id: string, text: string) {
    return {
      id,
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text }],
            },
          ],
        },
      },
    }
  }

  it('quotes visible rich_text verbatim with one section per block', () => {
    const summary = summariseNotebookBlocks({
      recordId: 'r1',
      title: 'EXP-1',
      deepLink: '/records/r1',
      blocks: [textBlock('b1', 'Objective: measure kinetics'), textBlock('b2', 'Result: 7.4')],
    })
    expect(summary.context.version).toBe(1)
    expect(summary.context.objects).toHaveLength(1)
    expect(summary.context.objects[0]?.sections.map((s) => s.body)).toEqual([
      'Objective: measure kinetics',
      'Result: 7.4',
    ])
    expect(summary.keyPoints).toEqual(['Objective: measure kinetics', 'Result: 7.4'])
    // A local summary satisfies the minimal context input.
    const proposal = buildTextDraftProposal({
      recordTitle: 'EXP-1',
      envelope: summary.context,
      keyPoints: summary.keyPoints,
      groundedFrom: summary.groundedFrom,
    })
    expect(proposal?.draftText).toContain('Objective: measure kinetics')
    expect(proposal?.groundedFrom).toContain('visible notebook blocks')
    expect(
      validateBlock({ type: proposal!.block.type, payload: proposal!.block.payload }).ok,
    ).toBe(true)
  })

  it('marks non-text blocks without inventing content and caps sources honestly', () => {
    const summary = summariseNotebookBlocks({
      recordId: 'r1',
      title: 'EXP-1',
      deepLink: '/records/r1',
      blocks: [
        textBlock('b1', 'Objective'),
        { id: 'b2', type: 'chart', payload: { spec: {} } },
      ],
      maxBlocks: 1,
    })
    expect(summary.context.objects[0]?.sections.map((s) => s.heading)).toEqual([
      'rich_text block 1',
      'Truncation',
    ])
    expect(summary.context.objects[0]?.truncated).toBe(true)
    // Non-text bodies never become key points.
    expect(summary.keyPoints).toEqual(['Objective'])
  })

  it('truncates long bodies with a marker', () => {
    const summary = summariseNotebookBlocks({
      recordId: 'r1',
      title: 'EXP-1',
      deepLink: '/records/r1',
      blocks: [textBlock('b1', 'x'.repeat(600))],
      maxCharsPerBlock: 100,
    })
    const body = summary.context.objects[0]?.sections[0]?.body ?? ''
    expect(body.endsWith('…')).toBe(true)
    expect(body.length).toBeLessThan(600)
  })
})
