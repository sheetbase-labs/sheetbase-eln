import { describe, expect, it, vi } from 'vitest'

import {
  extractSheetDefinitionDraft,
  previewSheetDefinitionExtraction,
} from '#/lib/sheet-definition-data'
import {
  parseSheetDefinitionExtractionPreview,
  parseSheetDefinitionExtractionSelection,
} from '#/lib/sheet-definition-extraction'
import { validSheetDefinitionConfiguration } from './fixtures/sheet-definition'

const INSTANCE = 'a1000000-0000-4000-8000-000000000001'
const DEFINITION = 'a1000000-0000-4000-8000-000000000002'
const VERSION = 'a1000000-0000-4000-8000-000000000003'
const WORKSPACE = 'a1000000-0000-4000-8000-000000000004'

function selection() {
  const configuration = validSheetDefinitionConfiguration()
  return parseSheetDefinitionExtractionSelection({
    bindings: configuration.bindings.map((binding) => ({
      bindingId: binding.id,
      key: binding.key,
      parameter: configuration.parameters.find(
        (parameter) => parameter.id === binding.parameterId,
      ),
    })),
    columnIds: configuration.columns
      .filter((column) => column.source.kind !== 'calculated')
      .map((column) => column.id),
    joinIds: configuration.joins.map((join) => join.id),
    localFieldIds: [],
    calculationIds: [],
    rowIdentity: configuration.rowIdentity,
    includePresentation: true,
  })
}

function preview() {
  const configuration = validSheetDefinitionConfiguration()
  configuration.columns = configuration.columns.slice(0, 2)
  configuration.calculations = []
  configuration.writeBackRules = []
  configuration.actions = []
  configuration.presentation.columnOrder = configuration.columns.map(
    (column) => column.id,
  )
  return {
    source: { instanceId: INSTANCE, instanceRevision: 7 },
    selection: selection(),
    configuration,
    manifest: {
      reusable: {
        parameterIds: configuration.parameters.map((parameter) => parameter.id),
        bindingIds: configuration.bindings.map((binding) => binding.id),
        sourceColumnIds: configuration.columns.map((column) => column.id),
        joinIds: configuration.joins.map((join) => join.id),
        localFieldIds: [],
        calculationIds: [],
        presentationDefaultsIncluded: true,
      },
      excluded: {
        concreteBindingValueBindingIds: configuration.bindings.map(
          (binding) => binding.id,
        ),
        unselectedSourceColumnIds: [],
        unselectedJoinIds: [],
        unselectedLocalFieldIds: [],
        unselectedCalculationIds: [],
        localValues: { rowCount: 2, cellCount: 3 },
        calculationOverrideIds: [],
        calculationResults: 'all',
        writeBackRuleIds: [],
        actionIds: [],
        presentationValueFilterCount: 1,
        presentationOutOfRangeWidthColumnIds: [],
        rowIdentitiesDerivedFromValues: 'all',
      },
    },
  }
}

function mutationWire() {
  const now = '2026-08-15T12:00:00Z'
  return {
    definition: {
      id: DEFINITION,
      workspace_id: WORKSPACE,
      key: 'reusable_sheet',
      name: 'Reusable sheet',
      description: null,
      lifecycle: 'active' as const,
      revision: 1,
      created_at: now,
      updated_at: now,
      created_by_user_id: 'owner',
      updated_by_user_id: 'owner',
    },
    version: {
      id: VERSION,
      definition_id: DEFINITION,
      version: 1,
      lifecycle: 'draft' as const,
      configuration_format_version: 1,
      configuration: preview().configuration,
      revision: 1,
      created_at: now,
      updated_at: now,
      created_by_user_id: 'owner',
      updated_by_user_id: 'owner',
      published_at: null,
      published_by_user_id: null,
      retired_at: null,
      retired_by_user_id: null,
    },
    preview: preview(),
  }
}

describe('Sheet Definition extraction contract', () => {
  it('parses an explicit reusable/excluded manifest and rejects value payloads', () => {
    const parsed = parseSheetDefinitionExtractionPreview(preview())
    expect(parsed.configuration.bindings).toHaveLength(2)
    expect(parsed.manifest.excluded.localValues).toEqual({
      rowCount: 2,
      cellCount: 3,
    })
    expect(() =>
      parseSheetDefinitionExtractionPreview({
        ...preview(),
        manifest: {
          ...preview().manifest,
          excluded: {
            ...preview().manifest.excluded,
            localValuePayload: { row: 'experiment value' },
          },
        },
      }),
    ).toThrow()
  })

  it('requires stable explicit parameter contracts and unique selections', () => {
    const duplicate = selection()
    duplicate.localFieldIds = [duplicate.columnIds[0], duplicate.columnIds[0]]
    expect(() => parseSheetDefinitionExtractionSelection(duplicate)).toThrow()
    expect(selection().bindings[0].parameter.type.kind).toBe('dataset')
  })

  it('uses controlled preview/extract RPCs and parses a draft only', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(mutationWire())
    const client: any = { rpc }
    await previewSheetDefinitionExtraction(INSTANCE, 7, selection(), client)
    const result = await extractSheetDefinitionDraft(
      {
        instanceId: INSTANCE,
        expectedInstanceRevision: 7,
        key: 'reusable_sheet',
        name: 'Reusable sheet',
        selection: selection(),
      },
      client,
    )
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'preview_sheet_definition_extraction',
      'extract_sheet_definition_draft',
    ])
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_instance_id: INSTANCE,
      p_expected_instance_revision: 7,
    })
    expect(result.version.lifecycle).toBe('draft')
    expect(result.version.publishedAt).toBeNull()
  })
})
