import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
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
  const categoryFieldId = '55555555-5555-4555-8555-555555555555'
  const templateId = '66666666-6666-4666-8666-666666666666'
  return {
    list: vi.fn(async (resource: string) => {
      if (resource === 'model_kinds') {
        return [
          { key: 'sample', label: 'Samples', identity_table: 'api.records' },
        ]
      }
      if (resource === 'model_base_fields') return []
      if (resource === 'record_field_definitions') {
        return [
          {
            id: categoryFieldId,
            kind: 'sample',
            field_name: 'status',
            label: 'Status',
            description: null,
            display_order: 0,
            logical_type: 'category',
            nullable: true,
            default_value: null,
            unit: null,
            quantity: null,
            validation: {},
            cardinality: 'one',
            category_source: null,
            relationship: null,
            lifecycle: 'active',
          },
        ]
      }
      if (resource === 'model_field_options') {
        return [
          {
            id: 'opt-1',
            definition_id: categoryFieldId,
            key: 'open',
            label: 'Open',
            display_order: 0,
            lifecycle: 'active',
          },
        ]
      }
      if (resource === 'notebook_templates') {
        return [
          {
            id: templateId,
            workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            key: 'stability_nb',
            name: 'Stability notebook',
            description: null,
            lifecycle: 'active',
            revision: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            created_by_user_id: null,
            updated_by_user_id: null,
          },
        ]
      }
      if (resource === 'notebook_template_versions') return []
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
            default_value: 1.5,
            quantity: {
              kind: 'concentration',
              dimension: 'mass / volume',
              storageUnit: 'mg/mL',
            },
            validation: { minimum: 0 },
            category: null,
            relationship: null,
            cardinality: 'one',
            lifecycle: 'active',
            display_order: 0,
          },
          {
            field_id: 'field-retired',
            key: 'legacy_titre',
            label: 'Legacy titre',
            description: null,
            logical_type: 'text',
            nullable: true,
            default_value: null,
            quantity: null,
            validation: {},
            category: null,
            relationship: null,
            cardinality: 'one',
            lifecycle: 'retired',
            display_order: 1,
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
      if (name === 'list_configuration_vocabularies') {
        return {
          items: [
            {
              id: `model:${categoryFieldId}`,
              label: 'Status',
              source_kind: 'model',
              source_id: 'sample',
              source_label: 'Samples',
              field_key: 'status',
              category_kind: 'embedded',
              vocabulary_id: null,
              terms: [
                {
                  id: 'opt-1',
                  key: 'open',
                  label: 'Open',
                  lifecycle: 'active',
                },
              ],
            },
          ],
          hasMore: false,
        }
      }
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
      if (name === 'preview_sheet_instance_definition_upgrade')
        return {
          source: {
            instanceId: payload.p_instance_id,
            instanceRevision: payload.p_expected_instance_revision,
            definitionId,
            versionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            version: 1,
          },
          target: {
            definitionId,
            versionId: payload.p_target_definition_version_id,
            version: 2,
          },
          automaticChanges: [],
          conflicts: [
            {
              id: `parameter-required:${localFieldId}`,
              kind: 'parameter-required',
              sourceId: localFieldId,
              targetCandidates: [],
              allowedOutcomes: ['defer'],
              instanceReferences: {
                localField: false,
                localValueCount: 0,
                calculationIds: [],
                calculationOverride: false,
                presentation: false,
              },
            },
          ],
          preserved: {
            localFieldIds: [],
            localValueRowCount: 0,
            instanceCalculationIds: [],
            calculationOverrideIds: [],
            presentationOwnedByInstance: true,
            bindingProvenanceRevalidated: true,
            writeOwnershipFromTarget: true,
          },
        }
      if (name === 'apply_sheet_instance_definition_upgrade')
        return {
          status: 'deferred',
          preview: {
            source: {
              instanceId: payload.p_instance_id,
              instanceRevision: payload.p_expected_instance_revision,
              definitionId,
              versionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              version: 1,
            },
            target: {
              definitionId,
              versionId: payload.p_target_definition_version_id,
              version: 2,
            },
            automaticChanges: [],
            conflicts: [
              {
                id: `parameter-required:${localFieldId}`,
                kind: 'parameter-required',
                sourceId: localFieldId,
                targetCandidates: [],
                allowedOutcomes: ['defer'],
                instanceReferences: {
                  localField: false,
                  localValueCount: 0,
                  calculationIds: [],
                  calculationOverride: false,
                  presentation: false,
                },
              },
            ],
            preserved: {
              localFieldIds: [],
              localValueRowCount: 0,
              instanceCalculationIds: [],
              calculationOverrideIds: [],
              presentationOwnedByInstance: true,
              bindingProvenanceRevalidated: true,
              writeOwnershipFromTarget: true,
            },
          },
        }
      return { dependencies: [] }
    }) as DataClient['rpc'],
    count: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    remove: vi.fn(),
  }
}

function mount(
  role: 'scientist' | 'steward' | 'owner',
  searchKind: 'schema' | 'definition' = 'schema',
) {
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
    expect(configurationRoleCopy('steward')).toMatch(/Notebook Templates/)
    expect(configurationRoleCopy('owner')).toMatch(/Administration/)
    expect(configurationRoleCopy('viewer')).toMatch(/inspect this workspace/)
  })

  it('lets a steward publish evolution while a scientist cannot', async () => {
    const user = userEvent.setup()
    mount('steward')
    expect(await screen.findByText('titre')).toBeTruthy()
    await user.type(screen.getByLabelText('New field key'), 'result')
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

  it('preserves existing field semantics and builds a typed category field', async () => {
    const user = userEvent.setup()
    const { client } = mount('steward')
    await screen.findByText('titre')
    await user.type(screen.getByLabelText('New field key'), 'qc_outcome')
    await user.type(screen.getByLabelText('Label'), 'QC outcome')
    await user.selectOptions(screen.getByLabelText('Type'), 'category')
    await user.type(
      screen.getByLabelText('Embedded options, comma separated'),
      'pass, fail',
    )
    await user.click(screen.getByRole('button', { name: 'Preview impact' }))

    const previewCall = (client.rpc as any).mock.calls.find(
      ([name]: [string]) => name === 'preview_dataset_schema_evolution',
    )
    expect(previewCall?.[1].p_fields).toMatchObject([
      {
        field_id: 'field-1',
        default_value: 1.5,
        quantity: {
          kind: 'concentration',
          dimension: 'mass / volume',
          storageUnit: 'mg/mL',
        },
        validation: { minimum: 0 },
      },
      { field_id: 'field-retired', lifecycle: 'retired' },
      {
        key: 'qc_outcome',
        logical_type: 'category',
        category: {
          kind: 'embedded',
          options: [
            { key: 'pass', label: 'pass' },
            { key: 'fail', label: 'fail' },
          ],
        },
      },
    ])
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
      await screen.findByRole('button', {
        name: 'Field and calculation promotion',
      }),
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
    await user.type(
      screen.getAllByLabelText('Stable key')[0],
      'new_sheet_definition',
    )
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
    await screen.findByLabelText('Draft configuration JSON')
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

  it('edits draft configuration JSON before saving', async () => {
    const user = userEvent.setup()
    const { client } = mount('steward', 'definition')
    const textarea = await screen.findByLabelText('Draft configuration JSON')
    const currentConfig = JSON.parse((textarea as HTMLTextAreaElement).value)
    currentConfig.presentation = {
      ...currentConfig.presentation,
      density: 'compact',
    }
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify(currentConfig, null, 2),
      },
    })
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    const updateCall = (client.rpc as any).mock.calls.find(
      ([name]: [string]) => name === 'update_sheet_definition_draft',
    )
    expect(updateCall).toBeTruthy()
    expect(updateCall[1].p_configuration.presentation.density).toBe('compact')
  })

  it('uses selected definition revision when retiring a definition', async () => {
    const user = userEvent.setup()
    const { client } = mount('owner', 'definition')
    await screen.findByRole('button', { name: 'Retire definition' })
    await user.click(screen.getByRole('button', { name: 'Retire definition' }))
    const retireCall = (client.rpc as any).mock.calls.find(
      ([name]: [string]) => name === 'retire_sheet_definition',
    )
    expect(retireCall).toBeTruthy()
    expect(retireCall[1].p_expected_revision).toBe(3)
  })

  it('previews conflicted consumer upgrades, collects decisions and parameters, then submits', async () => {
    const user = userEvent.setup()
    const { client } = mount('owner', 'definition')
    await user.type(
      await screen.findByLabelText('Sheet Instance ID'),
      '33333333-3333-4333-8333-333333333333',
    )
    await user.type(screen.getByLabelText('Expected instance revision'), '9')
    await user.click(
      screen.getByRole('button', { name: 'Preview consumer upgrade' }),
    )
    expect(
      await screen.findByText(
        `parameter-required:${'44444444-4444-4444-8444-444444444444'}`,
      ),
    ).toBeTruthy()
    await user.selectOptions(
      document.getElementById(
        `upgrade-conflict-parameter-required:${'44444444-4444-4444-8444-444444444444'}`,
      )!,
      'defer',
    )
    await user.click(
      screen.getByRole('button', { name: 'Apply consumer upgrade' }),
    )
    const previewCall = (client.rpc as any).mock.calls.find(
      ([name]: [string]) =>
        name === 'preview_sheet_instance_definition_upgrade',
    )
    const applyCall = (client.rpc as any).mock.calls.find(
      ([name]: [string]) => name === 'apply_sheet_instance_definition_upgrade',
    )
    expect(previewCall?.[1].p_expected_instance_revision).toBe(9)
    expect(applyCall?.[1].p_decisions).toEqual([
      {
        conflictId: `parameter-required:44444444-4444-4444-8444-444444444444`,
        outcome: 'defer',
      },
    ])
    expect(applyCall?.[1].p_parameter_inputs).toEqual([])
    expect(
      await screen.findByText('Upgrade deferred until conflicts are resolved.'),
    ).toBeTruthy()
  })

  it('exposes vocabularies in the catalogue and opens vocabulary kind', async () => {
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
          search={{ kind: 'vocabulary', id: undefined, model: undefined }}
          onSearchChange={onSearchChange}
        />
      </QueryClientProvider>,
    )
    await user.click(await screen.findByRole('button', { name: 'Status' }))
    expect(onSearchChange).toHaveBeenCalledWith({
      kind: 'vocabulary',
      id: 'model:55555555-5555-4555-8555-555555555555',
      model: undefined,
    })
  })

  it('lists notebook template names in the catalogue', async () => {
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
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(
      await screen.findByRole('button', { name: /Stability notebook/ }),
    ).toBeTruthy()
  })

  it('exposes calculation promotion controls on the promotion plane', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigurationWorkspace
          client={fakeClient()}
          workspaceId="workspace-1"
          role="steward"
          search={{ kind: 'promotion', id: undefined, model: undefined }}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(
      screen.getByRole('button', { name: 'Preview calculation promotion' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Promote calculation' }),
    ).toBeTruthy()
    expect(screen.getByLabelText('Local calculation')).toBeTruthy()
  })
})
