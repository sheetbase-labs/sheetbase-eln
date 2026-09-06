import { describe, expect, it } from 'vitest'

import type { AiContextEnvelope } from './ai-context'
import type { AiCitation } from './ai-retrieval'
import {
  ASSISTANCE_NOTE,
  ASSIST_STUB_MODEL,
  attachGrounding,
  explainBlockValidation,
  explainPlateValidation,
  explainPropertyValidation,
  explainSheetWriteBack,
  stubPhraseExplanation,
} from './assist-explain'
import type { AssistExplanation } from './assist-explain'
import { GATEWAY_MODELS } from './ai-gateway'
import type { RecordFieldDefinition } from './scientific-records'

function fieldDef(
  overrides: Partial<RecordFieldDefinition> = {},
): RecordFieldDefinition {
  return {
    id: '11111111-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000001',
    kind: 'experiment',
    fieldName: 'organism',
    label: 'Organism',
    description: null,
    displayOrder: 0,
    logicalType: 'text',
    nullable: false,
    defaultValue: null,
    unit: null,
    validation: {},
    ...overrides,
  } as RecordFieldDefinition
}

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
          {
            heading: 'Properties',
            body: 'organism: E. coli',
            truncated: false,
          },
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

describe('assist-explain block validation', () => {
  it('grounds every claim in the block kernel with a citation', () => {
    const explanation = explainBlockValidation({
      blockType: 'chart',
      errors: [
        {
          code: 'missing_required_field',
          field: 'spec',
          message: 'spec is required.',
        },
        {
          code: 'invalid_field_value',
          field: 'spec.type',
          message: 'Unknown chart type.',
        },
      ],
    })
    expect(explanation).not.toBeNull()
    expect(explanation?.title).toContain('chart')
    expect(explanation?.whatFailed).toContain('Nothing was written')
    expect(explanation?.why).toHaveLength(2)
    for (const claim of explanation?.why ?? []) {
      expect(claim.text.length).toBeGreaterThan(0)
      expect(claim.citation.label).toContain('Block rule')
      expect(claim.citation.detail).toContain('chart')
    }
    expect(explanation?.citations).toHaveLength(2)
    expect(explanation?.howTo.length).toBeGreaterThan(0)
    expect(explanation?.groundedFrom).toContain('validateBlock')
  })

  it('returns null when there is nothing to explain', () => {
    expect(
      explainBlockValidation({ blockType: 'chart', errors: [] }),
    ).toBeNull()
  })
})

describe('assist-explain property validation', () => {
  it('cites the field definition behind each failure', () => {
    const explanation = explainPropertyValidation({
      kind: 'experiment',
      errors: [{ field: 'organism', message: 'Organism is required.' }],
      definitions: [fieldDef()],
    })
    expect(explanation?.why[0]?.citation.label).toBe('Field rule organism')
    expect(explanation?.why[0]?.citation.detail).toContain('Organism')
    expect(explanation?.why[0]?.text).toContain('Organism is required.')
    expect(explanation?.howTo.length).toBeGreaterThan(0)
  })

  it('stays honest when no active definition exists', () => {
    const explanation = explainPropertyValidation({
      kind: 'experiment',
      errors: [
        { field: 'retired_field', message: 'Retired field has a value.' },
      ],
      definitions: [fieldDef()],
    })
    expect(explanation?.why[0]?.citation.detail).toContain(
      'no active field definition',
    )
  })

  it('returns null when there is nothing to explain', () => {
    expect(
      explainPropertyValidation({
        kind: 'experiment',
        errors: [],
        definitions: [],
      }),
    ).toBeNull()
  })
})

describe('assist-explain sheet write-back', () => {
  it('points at the offending row and field with fail-closed language', () => {
    const explanation = explainSheetWriteBack({
      errors: [{ code: 'revision_mismatch', rowId: 'row-1', fieldId: 'col-a' }],
    })
    expect(explanation?.whatFailed).toContain('revision_mismatch')
    expect(explanation?.whatFailed).toContain('Nothing was written')
    expect(explanation?.why[0]?.text).toContain('row-1')
    expect(explanation?.why[0]?.citation.label).toContain('revision_mismatch')
    expect(explanation?.howTo.join(' ')).toContain('Pending values are kept')
  })

  it('explains mixed-authority rejection without blaming validation', () => {
    const explanation = explainSheetWriteBack({
      errors: [],
      mixedAuthority: true,
    })
    expect(explanation?.whatFailed).toContain(
      'more than one authoritative target',
    )
    expect(explanation?.howTo.join(' ')).toContain('Split the edit')
  })

  it('returns null for an empty batch without the mixed-authority flag', () => {
    expect(explainSheetWriteBack({ errors: [] })).toBeNull()
  })
})

describe('assist-explain plate validation', () => {
  it('cites the plate kernel with the well code', () => {
    const explanation = explainPlateValidation({
      errors: [
        {
          code: 'missing_sample_ref',
          field: 'wells[3]',
          message: 'Sample well has no sample reference.',
          wellCode: 'B2',
        },
      ],
    })
    expect(explanation?.why[0]?.citation.detail).toContain('B2')
    expect(explanation?.why[0]?.text).toContain('B2')
    expect(explanation?.groundedFrom).toContain('validatePlateDesign')
  })

  it('returns null when there is nothing to explain', () => {
    expect(explainPlateValidation({ errors: [] })).toBeNull()
  })
})

describe('assist-explain grounding', () => {
  const base: AssistExplanation = {
    title: 'Why write-back was rejected',
    whatFailed: 'Rejected. Nothing was written.',
    why: [
      {
        text: 'Server rejected the batch.',
        citation: { label: 'Write-back rule x', detail: 'kernel' },
      },
    ],
    howTo: ['Fix and retry.'],
    citations: [{ label: 'Write-back rule x', detail: 'kernel' }],
    groundedFrom: 'kernel',
  }

  it('merges envelope objects and unmatched citations as cited sources', () => {
    const merged = attachGrounding(base, {
      envelope: envelope(),
      citations: [
        citation(),
        citation({ stableId: 'ds-9', kind: 'dataset', title: 'Assay' }),
      ],
    })
    expect(merged.citations).toHaveLength(3)
    expect(merged.citations[1]?.label).toContain('Visible experiment')
    expect(merged.citations[1]?.deepLink).toBe('/records/rec-1')
    expect(merged.citations[2]?.label).toContain('Assay')
    // Grounded facts stay primary: original claims untouched and first.
    expect(merged.why).toEqual(base.why)
    expect(merged.citations[0]).toEqual(base.citations[0])
  })

  it('never mutates the input and returns it when there is nothing to merge', () => {
    const merged = attachGrounding(base, { envelope: null, citations: null })
    expect(merged).toBe(base)
  })
})

describe('assist-explain stub phrasing', () => {
  it('marks gateway phrasing as assistance naming the citations', async () => {
    const explanation = explainBlockValidation({
      blockType: 'chart',
      errors: [
        { code: 'missing_required_field', message: 'spec is required.' },
      ],
    })
    const phrasing = await stubPhraseExplanation(explanation!)
    expect(phrasing.assistance).toBe(true)
    expect(phrasing.model).toBe(ASSIST_STUB_MODEL)
    expect(GATEWAY_MODELS as readonly string[]).toContain(phrasing.model)
    expect(phrasing.text).toContain('Block rule missing_required_field')
    expect(ASSISTANCE_NOTE).toContain('Not authoritative')
  })
})
