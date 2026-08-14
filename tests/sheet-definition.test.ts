import { describe, expect, it } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import {
  createSheetDefinition,
  fetchSheetDefinitionVersions,
  fetchSheetDefinitions,
  publishSheetDefinitionVersion,
} from '#/lib/sheet-definition-data'
import { safeParseSheetDefinitionConfiguration } from '#/lib/sheet-definition'
import {
  sheetDefinitionFixtureIds as ids,
  sheetDefinitionInvalidCases,
  sheetDefinitionValidCases,
  validSheetDefinitionConfiguration,
} from './fixtures/sheet-definition'

describe('Sheet Definition configuration contract', () => {
  it('accepts the complete typed configuration and preserves stable nested IDs', () => {
    const result = safeParseSheetDefinitionConfiguration(
      validSheetDefinitionConfiguration(),
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.columns.map((column) => column.id)).toEqual([
        ids.columnA,
        ids.columnB,
        ids.columnC,
      ])
      expect(result.data.columns[0].field.fieldId).toBe(ids.columnA)
    }
  })

  it.each([
    'formatVersion',
    'parameters',
    'bindings',
    'rowIdentity',
    'joins',
    'columns',
    'calculations',
    'writeBackRules',
    'actions',
    'presentation',
  ] as const)('rejects malformed %s', (section) => {
    const configuration = structuredClone(
      validSheetDefinitionConfiguration(),
    ) as Record<string, unknown>
    configuration[section] = null
    expect(safeParseSheetDefinitionConfiguration(configuration).success).toBe(
      false,
    )
  })

  it.each([
    [
      'binding → parameter',
      (value: any) => (value.bindings[0].parameterId = crypto.randomUUID()),
    ],
    [
      'row identity → column',
      (value: any) => (value.rowIdentity.columnIds[0] = crypto.randomUUID()),
    ],
    [
      'join → binding',
      (value: any) => (value.joins[0].leftBindingId = crypto.randomUUID()),
    ],
    [
      'calculation → input',
      (value: any) =>
        (value.calculations[0].inputColumnIds[0] = crypto.randomUUID()),
    ],
    [
      'write-back → column',
      (value: any) =>
        (value.writeBackRules[0].mappings[0].columnId = crypto.randomUUID()),
    ],
    [
      'action → parameter',
      (value: any) => (value.actions[0].parameterId = crypto.randomUUID()),
    ],
    [
      'presentation → column',
      (value: any) =>
        (value.presentation.hiddenColumnIds[0] = crypto.randomUUID()),
    ],
  ])('rejects unresolved %s references', (_name, mutate) => {
    const configuration = structuredClone(validSheetDefinitionConfiguration())
    mutate(configuration)
    expect(safeParseSheetDefinitionConfiguration(configuration).success).toBe(
      false,
    )
  })

  it.each(sheetDefinitionInvalidCases)(
    'rejects $name identically at the typed boundary',
    ({ mutate }) => {
      const configuration = structuredClone(validSheetDefinitionConfiguration())
      mutate(configuration)
      expect(safeParseSheetDefinitionConfiguration(configuration).success).toBe(
        false,
      )
    },
  )

  it.each([
    ['text', 'result'],
    ['integer', 12],
    ['decimal', 12.5],
    ['boolean', true],
    ['date', '2026-08-14'],
    ['timestamp', '2026-08-14T12:30:00Z'],
    ['category', 'a0000000-0000-7000-8000-000000000001'],
    ['reference', 'a0000000-0000-7000-8000-000000000002'],
  ] as const)(
    'accepts a typed %s scalar default',
    (valueType, defaultValue) => {
      const configuration = structuredClone(validSheetDefinitionConfiguration())
      configuration.parameters[0] = {
        ...configuration.parameters[0],
        type: { kind: 'scalar', valueType },
        defaultValue,
      }
      expect(safeParseSheetDefinitionConfiguration(configuration).success).toBe(
        true,
      )
    },
  )

  it.each(sheetDefinitionValidCases)(
    'accepts $name identically at the typed boundary',
    ({ mutate }) => {
      const configuration = structuredClone(validSheetDefinitionConfiguration())
      mutate(configuration)
      expect(safeParseSheetDefinitionConfiguration(configuration).success).toBe(
        true,
      )
    },
  )
})

describe('Sheet Definition data boundary', () => {
  const definitionWire = {
    id: crypto.randomUUID(),
    workspace_id: crypto.randomUUID(),
    key: 'purification_summary',
    name: 'Purification summary',
    description: null,
    lifecycle: 'active' as const,
    revision: '1',
    created_at: '2026-08-14T00:00:00Z',
    updated_at: '2026-08-14T00:00:00Z',
    created_by_user_id: 'owner',
    updated_by_user_id: 'owner',
  }
  const versionWire = {
    id: crypto.randomUUID(),
    definition_id: definitionWire.id,
    version: 1,
    lifecycle: 'draft' as const,
    configuration_format_version: 1 as const,
    configuration: validSheetDefinitionConfiguration(),
    revision: '1',
    created_at: '2026-08-14T00:00:00Z',
    updated_at: '2026-08-14T00:00:00Z',
    created_by_user_id: 'owner',
    updated_by_user_id: 'owner',
    published_at: null,
    published_by_user_id: null,
    retired_at: null,
    retired_by_user_id: null,
  }

  it('uses supported table reads and controlled RPC writes', async () => {
    const calls: Array<[string, string, unknown?]> = []
    const client = {
      list: async (resource: string, query?: string) => {
        calls.push(['list', resource, query])
        return resource === 'sheet_definitions'
          ? [definitionWire]
          : [versionWire]
      },
      rpc: async (name: string, args: unknown) => {
        calls.push(['rpc', name, args])
        if (name === 'create_sheet_definition')
          return { definition: definitionWire, version: versionWire }
        return { ...versionWire, lifecycle: 'published', revision: '2' }
      },
    } as DataClient

    await expect(fetchSheetDefinitions(client)).resolves.toHaveLength(1)
    await expect(
      fetchSheetDefinitionVersions(definitionWire.id, client),
    ).resolves.toHaveLength(1)
    await expect(
      createSheetDefinition(
        {
          workspaceId: definitionWire.workspace_id,
          key: definitionWire.key,
          name: definitionWire.name,
          configuration: validSheetDefinitionConfiguration(),
        },
        client,
      ),
    ).resolves.toMatchObject({ version: { version: 1 } })
    await expect(
      publishSheetDefinitionVersion(versionWire.id, 1, client),
    ).resolves.toMatchObject({ lifecycle: 'published', revision: 2 })
    expect(calls.map((call) => call.slice(0, 2))).toEqual([
      ['list', 'sheet_definitions'],
      ['list', 'sheet_definition_versions'],
      ['rpc', 'create_sheet_definition'],
      ['rpc', 'publish_sheet_definition_version'],
    ])
  })
})
