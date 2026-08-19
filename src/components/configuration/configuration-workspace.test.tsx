import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ConfigurationWorkspace,
  configurationRoleCopy,
} from './configuration-workspace'
import type { DataClient } from '#/lib/data-client'

afterEach(cleanup)

function fakeClient(): DataClient {
  const definitionId = '11111111-1111-4111-8111-111111111111'
  const versionId = '22222222-2222-4222-8222-222222222222'
  const instanceId = '33333333-3333-4333-8333-333333333333'
  const localFieldId = '44444444-4444-4444-8444-444444444444'
  return {
    list: vi.fn(async (resource: string) => {
      if (resource === 'model_kinds') {
        return [
          { key: 'sample', label: 'Samples', identity_table: 'api.records' },
        ]
      }
      if (resource === 'model_base_fields') return []
      if (resource === 'record_field_definitions') return []
      if (resource === 'model_field_options') return []
      if (resource === 'dataset_schema_definitions') {
        return [
          {
            id: 'schema-1',
            key: 'stability_result',
            name: 'Stability result',
            description: null,
            lifecycle: 'active',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]
      }
      if (resource === 'dataset_schema_versions') {
        return [
          {
            id: 'ver-1',
            schema_id: 'schema-1',
            version: 1,
            revision: 1,
            lifecycle: 'active',
            published_at: '2026-01-01T00:00:00Z',
          },
        ]
      }
      if (resource === 'dataset_schema_version_fields') {
        return [
          {
            field_id: 'field-1',
            key: 'titre',
            label: 'Titre',
            description: null,
            logical_type: 'decimal',
            nullable: true,
            cardinality: 'one',
            lifecycle: 'active',
            display_order: 0,
          },
        ]
      }
      if (resource === 'sheet_definitions') {
        return [
          {
            id: definitionId,
            workspace_id: 'workspace-1',
            key: 'sheet_def',
            name: 'Sheet def',
            description: null,
            lifecycle: 'active',
            revision: 3,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            created_by_user_id: null,
            updated_by_user_id: null,
          },
        ]
      }
      if (resource === 'sheet_definition_versions') {
        return [
          {
            id: versionId,
            definition_id: definitionId,
            version: 1,
            lifecycle: 'draft',
            configuration_format_version: 1,
            configuration: {
              formatVersion: 1,
              parameters: [],
              bindings: [],
              rowIdentity: { kind: 'local', columnIds: [localFieldId] },
              joins: [],
              columns: [
                {
                  id: localFieldId,
                  field: {
                    fieldId: localFieldId,
                    key: 'row_identity',
                    label: 'Row identity',
                    description: null,
                    logicalType: 'reference',
                    nullable: false,
                    defaultValue: null,
                    cardinality: 'one',
                    quantity: null,
                    validation: {},
                    category: null,
                    relationship: {
                      target: { kind: 'model', modelKey: 'sample' },
                      cardinality: 'one',
                    },
                    computation: { mode: 'stored' },
                    lifecycle: 'active',
                  },
                  source: { kind: 'declared' },
                },
              ],
              calculations: [],
              writeBackRules: [],
              actions: [],
              presentation: {
                columnOrder: [localFieldId],
                hiddenColumnIds: [],
                columnWidths: {},
                frozenColumnCount: 0,
                density: 'standard',
                filters: [],
                sorts: [],
              },
            },
            revision: 7,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            created_by_user_id: null,
            updated_by_user_id: null,
            published_at: null,
            published_by_user_id: null,
            retired_at: null,
            retired_by_user_id: null,
          },
        ]
      }
      if (resource === 'sheet_instances') {
        return [
          {
            id: instanceId,
            workspace_id: 'workspace-1',
            project_id: null,
            notebook_record_id: null,
            source_definition_version_id: null,
            name: 'Instance A',
            description: null,
            lifecycle: 'active',
            revision: 9,
            state: {
              bindings: [],
              parameterValues: [],
              localFields: [
                {
                  fieldId: localFieldId,
                  key: 'row_identity',
                  label: 'Row identity',
                  description: null,
                  logicalType: 'reference',
                  nullable: false,
                  defaultValue: null,
                  cardinality: 'one',
                  quantity: null,
                  validation: {},
                  category: null,
                  relationship: {
                    target: { kind: 'model', modelKey: 'sample' },
                    cardinality: 'one',
                  },
                  computation: { mode: 'stored' },
                  lifecycle: 'active',
                },
              ],
              localValues: {},
              calculationOverrides: {},
              instanceCalculations: [],
              presentation: {
                columnOrder: [localFieldId],
                hiddenColumnIds: [],
                columnWidths: {},
                frozenColumnCount: 0,
                density: 'standard',
                filters: [],
                sorts: [],
              },
              provenance: { createdFrom: 'ad_hoc' },
              resolvedRowIdentity: {
                formatVersion: 1,
                kind: 'local',
                columnIds: [localFieldId],
                logicalTypes: ['reference'],
                sourceBindingId: null,
                sourceFieldId: null,
              },
            },
            duplicated_from_instance_id: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            created_by_user_id: null,
            updated_by_user_id: null,
          },
        ]
      }
      return []
    }) as DataClient['list'],
    rpc: vi.fn(async (name: string, payload: any) => {
      if (name === 'discover_object_dependencies') return { dependencies: [] }
      if (name === 'create_sheet_definition')
        return {
          definition: {
            id: definitionId,
            workspace_id: 'workspace-1',
            key: payload.p_key,
            name: payload.p_name,
            description: null,
            lifecycle: 'active',
            revision: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            created_by_user_id: null,
            updated_by_user_id: null,
          },
          version: {
            id: versionId,
            definition_id: definitionId,
            version: 1,
            lifecycle: 'draft',
            configuration_format_version: 1,
            configuration: payload.p_configuration,
            revision: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            created_by_user_id: null,
            updated_by_user_id: null,
            published_at: null,
            published_by_user_id: null,
            retired_at: null,
            retired_by_user_id: null,
          },
        }
      if (name === 'preview_sheet_definition_extraction')
        return {
          source: { instanceId, instanceRevision: 9 },
          selection: payload.p_selection,
          configuration: {
            formatVersion: 1,
            parameters: [],
            bindings: [],
            rowIdentity: { kind: 'local', columnIds: [localFieldId] },
            joins: [],
            columns: [
              {
                id: localFieldId,
                field: {
                  fieldId: localFieldId,
                  key: 'row_identity',
                  label: 'Row identity',
                  description: null,
                  logicalType: 'reference',
                  nullable: false,
                  defaultValue: null,
                  cardinality: 'one',
                  quantity: null,
                  validation: {},
                  category: null,
                  relationship: {
                    target: { kind: 'model', modelKey: 'sample' },
                    cardinality: 'one',
                  },
                  computation: { mode: 'stored' },
                  lifecycle: 'active',
                },
                source: { kind: 'declared' },
              },
            ],
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
          },
          manifest: {
            reusable: {
              parameterIds: [],
              bindingIds: [],
              sourceColumnIds: [],
              joinIds: [],
              localFieldIds: [localFieldId],
              calculationIds: [],
              presentationDefaultsIncluded: true,
            },
            excluded: {
              concreteBindingValueBindingIds: [],
              unselectedSourceColumnIds: [],
              unselectedJoinIds: [],
              unselectedLocalFieldIds: [],
              unselectedCalculationIds: [],
              localValues: { rowCount: 0, cellCount: 0 },
              calculationOverrideIds: [],
              calculationResults: 'all',
              writeBackRuleIds: [],
              actionIds: [],
              presentationValueFilterCount: 0,
              presentationOutOfRangeWidthColumnIds: [],
              rowIdentitiesDerivedFromValues: 'all',
            },
          },
        }
      if (name === 'extract_sheet_definition_draft')
        return {
          definition: {
            id: definitionId,
            workspace_id: 'workspace-1',
            key: payload.p_key,
            name: payload.p_name,
            description: null,
            lifecycle: 'active',
            revision: 2,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            created_by_user_id: null,
            updated_by_user_id: null,
          },
          version: {
            id: versionId,
            definition_id: definitionId,
            version: 1,
            lifecycle: 'draft',
            configuration_format_version: 1,
            configuration: payload.p_selection,
            revision: 2,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            created_by_user_id: null,
            updated_by_user_id: null,
            published_at: null,
            published_by_user_id: null,
            retired_at: null,
            retired_by_user_id: null,
          },
          preview: {
            source: { instanceId, instanceRevision: 9 },
            selection: payload.p_selection,
            configuration: {
              formatVersion: 1,
              parameters: [],
              bindings: [],
              rowIdentity: { kind: 'local', columnIds: [localFieldId] },
              joins: [],
              columns: [
                {
                  id: localFieldId,
                  field: {
                    fieldId: localFieldId,
                    key: 'row_identity',
                    label: 'Row identity',
                    description: null,
                    logicalType: 'reference',
                    nullable: false,
                    defaultValue: null,
                    cardinality: 'one',
                    quantity: null,
                    validation: {},
                    category: null,
                    relationship: {
                      target: { kind: 'model', modelKey: 'sample' },
                      cardinality: 'one',
                    },
                    computation: { mode: 'stored' },
                    lifecycle: 'active',
                  },
                  source: { kind: 'declared' },
                },
              ],
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
            },
            manifest: {
              reusable: {
                parameterIds: [],
                bindingIds: [],
                sourceColumnIds: [],
                joinIds: [],
                localFieldIds: [localFieldId],
                calculationIds: [],
                presentationDefaultsIncluded: true,
              },
              excluded: {
                concreteBindingValueBindingIds: [],
                unselectedSourceColumnIds: [],
                unselectedJoinIds: [],
                unselectedLocalFieldIds: [],
                unselectedCalculationIds: [],
                localValues: { rowCount: 0, cellCount: 0 },
                calculationOverrideIds: [],
                calculationResults: 'all',
                writeBackRuleIds: [],
                actionIds: [],
                presentationValueFilterCount: 0,
                presentationOutOfRangeWidthColumnIds: [],
                rowIdentitiesDerivedFromValues: 'all',
              },
            },
          },
        }
      if (name === 'update_sheet_definition_draft')
        return {
          id: versionId,
          definition_id: definitionId,
          version: 1,
          lifecycle: 'draft',
          configuration_format_version: 1,
          configuration: payload.p_configuration,
          revision: payload.p_expected_revision + 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          created_by_user_id: null,
          updated_by_user_id: null,
          published_at: null,
          published_by_user_id: null,
          retired_at: null,
          retired_by_user_id: null,
        }
      if (name === 'create_sheet_definition_version')
        return {
          id: '77777777-7777-4777-8777-777777777777',
          definition_id: definitionId,
          version: 2,
          lifecycle: 'draft',
          configuration_format_version: 1,
          configuration: payload.p_configuration,
          revision: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          created_by_user_id: null,
          updated_by_user_id: null,
          published_at: null,
          published_by_user_id: null,
          retired_at: null,
          retired_by_user_id: null,
        }
      return { dependencies: [] }
    }) as DataClient['rpc'],
    count: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    remove: vi.fn(),
  }
}

function mount(role: 'scientist' | 'steward' | 'owner', searchKind: 'schema' | 'definition' = 'schema') {
  const client = fakeClient()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ConfigurationWorkspace
        client={client}
        workspaceId="workspace-1"
        role={role}
        search={{
          kind: searchKind,
          id:
            searchKind === 'definition'
              ? '11111111-1111-4111-8111-111111111111'
              : 'schema-1',
          model: undefined,
        }}
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  )
  return { client }
}

describe('ConfigurationWorkspace', () => {
  it('explains scientist, steward and owner capability differences', () => {
    expect(configurationRoleCopy('scientist')).toMatch(/Data Steward/)
    expect(configurationRoleCopy('steward')).toMatch(/cannot administer/)
    expect(configurationRoleCopy('owner')).toMatch(/Administration/)
    expect(configurationRoleCopy('viewer')).toMatch(/inspect this workspace/)
  })

  it('lets a steward publish evolution while a scientist cannot', async () => {
    mount('steward')
    expect(await screen.findByText('titre')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Publish evolution' }),
    ).toHaveProperty('disabled', false)
    expect(screen.getAllByText('allowed').length).toBeGreaterThan(0)
    cleanup()
    mount('scientist')
    expect(await screen.findByText('titre')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Publish evolution' }),
    ).toHaveProperty('disabled', true)
    expect(
      screen.getByText(/Publishing schemas requires a Data Steward/),
    ).toBeTruthy()
  })

  it('opens the explicit promotion plane from the catalogue', async () => {
    const user = userEvent.setup()
    const onSearchChange = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigurationWorkspace
          client={fakeClient()}
          workspaceId="workspace-1"
          role="steward"
          search={{ kind: 'schema', id: 'schema-1', model: undefined }}
          onSearchChange={onSearchChange}
        />
      </QueryClientProvider>,
    )
    await user.click(
      await screen.findByRole('button', { name: 'Local field promotion' }),
    )
    expect(onSearchChange).toHaveBeenCalledWith({
      kind: 'promotion',
      id: undefined,
      model: undefined,
    })
  })

  it('creates a Sheet Definition draft with canonical writeBackRules and presentation keys', async () => {
    const user = userEvent.setup()
    const { client } = mount('steward', 'definition')
    await user.type(screen.getAllByLabelText('Stable key')[0], 'new_sheet_definition')
    await user.type(screen.getAllByLabelText('Name')[0], 'New sheet definition')
    await user.click(screen.getAllByRole('button', { name: 'Create draft' })[0])
    await waitFor(() =>
      expect(
        (client.rpc as any).mock.calls.some(
          ([name]: [string]) => name === 'create_sheet_definition',
        ),
      ).toBe(true),
    )
    const createCall = (client.rpc as any).mock.calls.find(
      ([name]: [string]) => name === 'create_sheet_definition',
    )
    expect(createCall).toBeTruthy()
    const payload = createCall[1]
    expect(payload.p_configuration.writeBackRules).toEqual([])
    expect(payload.p_configuration.presentation).toBeTruthy()
    expect(payload.p_configuration.writebackTargets).toBeUndefined()
    expect(payload.p_configuration.presentationDefaults).toBeUndefined()
  })

  it('exposes the create-from-instance extraction action', async () => {
    const user = userEvent.setup()
    mount('steward', 'definition')
    await user.type(
      screen.getByLabelText('Create from Sheet Instance ID'),
      '33333333-3333-4333-8333-333333333333',
    )
    const action = screen.getByRole('button', { name: 'Create from Instance' })
    expect(action).toHaveProperty('disabled', false)
    await user.click(action)
  })

  it('exposes save draft and new draft version actions for definitions', async () => {
    const user = userEvent.setup()
    const { client } = mount('steward', 'definition')
    await screen.findByRole('button', { name: 'Save draft' })
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await user.click(screen.getByRole('button', { name: 'New draft version' }))
    expect(
      (client.rpc as any).mock.calls.some(
        ([name]: [string]) => name === 'update_sheet_definition_draft',
      ),
    ).toBe(true)
    expect(
      (client.rpc as any).mock.calls.some(
        ([name]: [string]) => name === 'create_sheet_definition_version',
      ),
    ).toBe(true)
  })
})
