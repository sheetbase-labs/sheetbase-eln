/**
 * REUSE-01: discovery helper tests — purpose facets from tags in use,
 * protocol lifecycle states, consistent lifecycle badge variants, and
 * requirement summaries for all three reusable structures.
 */
import { describe, expect, it } from 'vitest'

import {
  derivePurposeFacets,
  matchesNotebookTemplateNeeds,
  matchesProtocolLifecycle,
  matchesPurposeFacet,
  notebookTemplateNeedsLine,
  parameterKindDetail,
  parentLifecycleBadgeVariant,
  protocolLifecycleState,
  protocolTemplateNeedsLine,
  sheetDefinitionNeedsLine,
  summarizeNotebookTemplateRequirements,
  summarizeSheetDefinitionRequirements,
  versionLifecycleBadgeVariant,
} from './reuse-discovery'
import type { NotebookTemplateConfiguration } from './notebook-template'
import type { SheetDefinitionConfiguration } from './sheet-definition'

describe('derivePurposeFacets', () => {
  it('derives options from tags in use, most-used first', () => {
    expect(
      derivePurposeFacets([
        { tags: ['stability', 'assay'] },
        { tags: ['stability'] },
        { tags: [] },
      ]),
    ).toEqual([
      { tag: 'stability', count: 2 },
      { tag: 'assay', count: 1 },
    ])
  })

  it('counts a repeated tag once per template', () => {
    expect(
      derivePurposeFacets([{ tags: ['assay', 'assay'] }]),
    ).toEqual([{ tag: 'assay', count: 1 }])
  })

  it('returns no options when nothing is tagged', () => {
    expect(derivePurposeFacets([{ tags: [] }])).toEqual([])
  })
})

describe('matchesPurposeFacet', () => {
  it('matches everything when no purpose is selected', () => {
    expect(matchesPurposeFacet([], 'all')).toBe(true)
    expect(matchesPurposeFacet(['assay'], 'all')).toBe(true)
  })

  it('matches only templates carrying the tag', () => {
    expect(matchesPurposeFacet(['assay'], 'assay')).toBe(true)
    expect(matchesPurposeFacet(['stability'], 'assay')).toBe(false)
    expect(matchesPurposeFacet([], 'assay')).toBe(false)
  })
})

describe('protocolLifecycleState', () => {
  it('reports archived regardless of status', () => {
    expect(
      protocolLifecycleState({ status: 'active', archivedAt: '2026-01-01' }),
    ).toBe('archived')
  })

  it('passes through draft/under_review/active when not archived', () => {
    expect(protocolLifecycleState({ status: 'draft', archivedAt: null })).toBe(
      'draft',
    )
    expect(
      protocolLifecycleState({ status: 'under_review', archivedAt: null }),
    ).toBe('under_review')
    expect(
      protocolLifecycleState({ status: 'active', archivedAt: null }),
    ).toBe('active')
  })

  it('filters by effective lifecycle', () => {
    const archived = { status: 'active', archivedAt: '2026-01-01' }
    expect(matchesProtocolLifecycle(archived, 'all')).toBe(true)
    expect(matchesProtocolLifecycle(archived, 'archived')).toBe(true)
    expect(matchesProtocolLifecycle(archived, 'active')).toBe(false)
  })
})

describe('lifecycle badge variants', () => {
  it('maps version lifecycles consistently', () => {
    expect(versionLifecycleBadgeVariant('published')).toBe('success')
    expect(versionLifecycleBadgeVariant('draft')).toBe('outline')
    expect(versionLifecycleBadgeVariant('retired')).toBe('warning')
  })

  it('maps parent lifecycles consistently', () => {
    expect(parentLifecycleBadgeVariant('active')).toBe('success')
    expect(parentLifecycleBadgeVariant('retired')).toBe('warning')
  })
})

describe('parameterKindDetail', () => {
  it('labels scalar, record and dataset parameter kinds', () => {
    expect(
      parameterKindDetail({ kind: 'scalar', valueType: 'integer' }),
    ).toBe('scalar · integer')
    expect(parameterKindDetail({ kind: 'record', modelKey: 'sample' })).toBe(
      'record · sample',
    )
    expect(
      parameterKindDetail({ kind: 'dataset', contract: { mode: 'lineage' } }),
    ).toBe('dataset · lineage')
  })
})

const SCALAR = 'integer'

function notebookConfiguration(
  overrides: Partial<NotebookTemplateConfiguration> = {},
): NotebookTemplateConfiguration {
  return {
    formatVersion: 1,
    parameters: [],
    placements: [],
    ...overrides,
  }
}

describe('summarizeNotebookTemplateRequirements', () => {
  it('splits required vs optional and counts placements by kind', () => {
    const summary = summarizeNotebookTemplateRequirements(
      notebookConfiguration({
        parameters: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            key: 'run_temp',
            label: 'Run temperature',
            required: true,
            type: { kind: 'scalar', valueType: SCALAR },
            constraints: {},
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            key: 'notes',
            label: 'Notes',
            required: false,
            type: { kind: 'scalar', valueType: 'text' },
            constraints: {},
          },
        ],
        placements: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            kind: 'narrative',
            order: 1,
            blockType: 'procedure_step',
            payload: {},
          },
          {
            id: '44444444-4444-4333-8333-444444444444',
            kind: 'sheet',
            order: 2,
            definitionVersionId: '55555555-5555-4555-8555-555555555555',
            parameterMappings: [
              {
                templateParameterId: '11111111-1111-4111-8111-111111111111',
                definitionParameterId:
                  '66666666-6666-4666-8666-666666666666',
              },
            ],
          },
        ],
      }),
    )
    expect(summary.parameterCount).toBe(2)
    expect(summary.requiredCount).toBe(1)
    expect(summary.optionalCount).toBe(1)
    expect(summary.requiredParameters).toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        key: 'run_temp',
        label: 'Run temperature',
        detail: 'scalar · integer',
        hasDefault: false,
      },
    ])
    expect(summary.placements).toEqual({
      total: 2,
      narrative: 1,
      sheet: 1,
      placeholder: 0,
    })
    expect(summary.mappedTemplateParameterIds).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ])
  })

  it('renders one-line catalogue previews', () => {
    expect(
      notebookTemplateNeedsLine({
        parameterCount: 2,
        requiredCount: 1,
        optionalCount: 1,
        placements: { total: 3, narrative: 1, sheet: 1, placeholder: 1 },
      }),
    ).toBe('1 required · 1 optional · 3 placements')
    expect(
      notebookTemplateNeedsLine({
        parameterCount: 5,
        requiredCount: 3,
        optionalCount: 2,
        placements: { total: 1, narrative: 0, sheet: 1, placeholder: 0 },
      }),
    ).toBe('3 required · 2 optional · 1 placement')
    expect(
      notebookTemplateNeedsLine({
        parameterCount: 0,
        requiredCount: 0,
        optionalCount: 0,
        placements: { total: 2, narrative: 2, sheet: 0, placeholder: 0 },
      }),
    ).toBe('No parameters · 2 placements')
  })

  it('filters by parameter needs', () => {
    const empty = { parameterCount: 0, requiredCount: 0 }
    expect(matchesNotebookTemplateNeeds(empty, 'all')).toBe(true)
    expect(matchesNotebookTemplateNeeds(empty, 'none')).toBe(true)
    expect(matchesNotebookTemplateNeeds(empty, 'has-required')).toBe(false)
    const optional = { parameterCount: 1, requiredCount: 0 }
    expect(matchesNotebookTemplateNeeds(optional, 'optional-only')).toBe(true)
    expect(matchesNotebookTemplateNeeds(optional, 'none')).toBe(false)
    const required = { parameterCount: 1, requiredCount: 1 }
    expect(matchesNotebookTemplateNeeds(required, 'has-required')).toBe(true)
    expect(matchesNotebookTemplateNeeds(required, 'optional-only')).toBe(false)
  })
})

function sheetConfiguration(): SheetDefinitionConfiguration {
  return {
    formatVersion: 1,
    parameters: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        key: 'lot',
        label: 'Lot',
        required: true,
        type: { kind: 'scalar', valueType: 'text' },
        constraints: {},
      },
    ],
    bindings: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        key: 'runs',
        parameterId: '11111111-1111-4111-8111-111111111111',
      },
    ],
    rowIdentity: {
      kind: 'source',
      columnIds: ['33333333-3333-4333-8333-333333333333'],
    },
    joins: [],
    columns: [],
    calculations: [],
    writeBackRules: [],
    actions: [],
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    },
  }
}

describe('summarizeSheetDefinitionRequirements', () => {
  it('summarises parameters, bindings and row identity', () => {
    const summary = summarizeSheetDefinitionRequirements(sheetConfiguration())
    expect(summary).toMatchObject({
      parameterCount: 1,
      requiredCount: 1,
      bindingCount: 1,
      rowIdentityKind: 'source',
    })
    expect(sheetDefinitionNeedsLine(summary)).toBe(
      '1 required · 1 binding · identity: source',
    )
  })
})

describe('protocolTemplateNeedsLine', () => {
  it('previews blocks, uses and readiness', () => {
    expect(
      protocolTemplateNeedsLine({
        blockCount: 3,
        usageCount: 2,
        instantiable: true,
        archived: false,
      }),
    ).toBe('3 blocks · 2 uses · Ready — needs a title and target project')
    expect(
      protocolTemplateNeedsLine({
        blockCount: undefined,
        usageCount: 0,
        instantiable: false,
        archived: true,
      }),
    ).toBe('Blocks unknown · 0 uses · Archived — cannot be used')
    expect(
      protocolTemplateNeedsLine({
        blockCount: 1,
        usageCount: 1,
        instantiable: false,
        archived: false,
      }),
    ).toBe('1 block · 1 use · Not ready — requires active status')
  })
})
