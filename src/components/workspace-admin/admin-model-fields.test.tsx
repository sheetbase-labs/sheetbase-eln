import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminModelFields } from './admin-model-fields'
import type { DataClient } from '#/lib/data-client'

afterEach(cleanup)

function fakeClient(): DataClient {
  return {
    list: vi.fn(async (resource: string, query = '') => {
      if (resource === 'model_kinds') {
        return [
          { key: 'sample', label: 'Samples', identity_table: 'api.records' },
          { key: 'batch', label: 'Batches', identity_table: 'api.records' },
        ]
      }
      if (resource === 'model_base_fields') {
        return query.includes('batch')
          ? [
              {
                field_key: 'batch_number',
                label: 'Batch number',
                presentation: { editor: true },
              },
            ]
          : [
              {
                field_key: 'identifier',
                label: 'Sample identifier',
                presentation: { editor: true },
              },
            ]
      }
      if (resource === 'record_field_definitions') {
        return query.includes('batch')
          ? []
          : [
              {
                id: 'field-1',
                kind: 'sample',
                field_name: 'purity',
                label: 'Purity',
                description: null,
                display_order: 1,
                logical_type: 'decimal',
                nullable: false,
                default_value: null,
                unit: { symbol: '%' },
                validation: {},
                lifecycle: 'active',
              },
            ]
      }
      if (resource === 'model_relationship_rules') return []
      if (resource === 'model_field_options') return []
      throw new Error(`Unexpected list request: ${resource}`)
    }) as DataClient['list'],
    rpc: vi.fn(async (name: string) => {
      if (name === 'model_field_usage') return 3
      if (name === 'create_model_field') return { id: 'field-new' }
      if (name === 'configure_model_field_semantics') return { id: 'field-new' }
      if (name === 'create_model_field_option') return { id: 'option-new' }
      if (name === 'activate_model_field') return { id: 'field-new' }
      if (name === 'preview_model_field_evolution')
        return {
          classification: 'migration-requiring',
          reason: 'retire_field',
          blocked: false,
          impact: [],
          guidance: [
            '3 record(s) of model "sample" carry a value for "Purity". Retiring locks the field.',
          ],
        }
      if (name === 'apply_model_field_evolution')
        return {
          classification: 'migration-requiring',
          reason: 'retire_field',
          blocked: false,
          ok: true,
        }
      if (name === 'discover_object_dependencies')
        return {
          kind: 'model_field',
          id: 'field-1',
          dependencies: [
            {
              kind: 'model_field_usage',
              id: 'field-1',
              relation: 'record_custom_field_count',
              liveness: 'informational',
              effect: 'informational',
              label: '3 records',
            },
          ],
        }
      if (name === 'discover_model_dependencies')
        return {
          kind: 'model',
          id: 'sample',
          dependencies: [
            {
              kind: 'model_field',
              id: 'field-1',
              relation: 'defines_field',
              liveness: 'active',
              effect: 'informational',
              label: 'Purity (purity) · 3 records',
            },
            {
              kind: 'record',
              id: 'rec-1',
              relation: 'carries_custom_values',
              liveness: 'active',
              effect: 'requires_migration',
              label: 'SMP-2026-0001',
            },
            {
              kind: 'model_relationship_rule',
              id: 'rule-1',
              relation: 'constrains_source_links',
              liveness: 'active',
              effect: 'requires_migration',
              label: 'sample → batch (0–∞)',
            },
            {
              kind: 'sheet_instance',
              id: 'inst-1',
              relation: 'binds_model_record',
              liveness: 'active',
              effect: 'requires_migration',
              label: 'Assay plate',
            },
            {
              kind: 'notebook_template_version',
              id: 'tpl-1',
              relation: 'parameter_model_contract',
              liveness: 'active',
              effect: 'requires_migration',
              label: 'pk_study v1',
            },
          ],
          truncated: false,
        }
      return undefined
    }) as DataClient['rpc'],
    count: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    remove: vi.fn(),
  }
}

function mount(canManage: boolean) {
  const client = fakeClient()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <AdminModelFields
        client={client}
        workspaceId="workspace-1"
        canManage={canManage}
      />
    </QueryClientProvider>,
  )
  return { client }
}

function mountControlled(
  selectedModelKey: string,
  onSelectedModelKeyChange: (modelKey: string) => void,
) {
  const client = fakeClient()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <AdminModelFields
        client={client}
        workspaceId="workspace-1"
        canManage
        selectedModelKey={selectedModelKey}
        onSelectedModelKeyChange={onSelectedModelKeyChange}
      />
    </QueryClientProvider>,
  )
}

describe('AdminModelFields', () => {
  it('uses controlled model state and reports model navigation', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    mountControlled('batch', onChange)

    expect(
      await screen.findByRole('combobox', {
        name: 'Model',
      }),
    ).toHaveProperty('value', 'batch')
    await within(screen.getByRole('combobox', { name: 'Model' })).findByRole('option', { name: 'Samples' })
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Model' }),
      'sample',
    )
    expect(onChange).toHaveBeenCalledWith('sample')
  })

  it('selects models, shows locked fields and opens the add-field form for an owner', async () => {
    const user = userEvent.setup()
    mount(true)

    expect(await screen.findByRole('combobox', { name: 'Model' })).toBeTruthy()
    expect(await screen.findByText('Sample identifier')).toBeTruthy()
    expect(screen.getByLabelText('Locked system field')).toBeTruthy()
    expect(screen.getByText('Read only')).toBeTruthy()
    expect(await screen.findByText('Purity')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Retire' }).hasAttribute('disabled'),
    ).toBe(false)

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Model' }),
      'batch',
    )
    expect(await screen.findByText('Batch number')).toBeTruthy()
    expect(screen.queryByText('Purity')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Add field' }))
    expect(
      screen.getByRole('dialog', { name: 'Add workspace field' }),
    ).toBeTruthy()
    expect(screen.getByLabelText('Stable key')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Add and activate' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('keeps add and retire controls read-only for a viewer', async () => {
    mount(false)
    await screen.findByText('Purity')

    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: 'Add field' })
          .hasAttribute('disabled'),
      ).toBe(true)
      expect(
        screen.getByRole('button', { name: 'Retire' }).hasAttribute('disabled'),
      ).toBe(true)
      expect(
        screen
          .getByRole('button', { name: 'Edit Purity' })
          .hasAttribute('disabled'),
      ).toBe(true)
    })
  })

  it('edits presentation metadata while showing the immutable contract', async () => {
    const user = userEvent.setup()
    const { client } = mount(true)
    await screen.findByText('Purity')

    await user.click(screen.getByRole('button', { name: 'Edit Purity' }))
    expect(
      screen.getByRole('dialog', { name: 'Edit workspace field' }),
    ).toBeTruthy()
    expect(screen.getByText(/Key:/)).toBeTruthy()
    expect(screen.getAllByText('purity').length).toBe(2)
    expect(screen.getAllByText(/Decimal number/).length).toBe(2)
    expect(await screen.findByText(/Evolution check:/)).toBeTruthy()

    const label = screen.getByLabelText('Label')
    await user.clear(label)
    await user.type(label, 'Sample purity')
    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), 'Measured purity')
    await user.clear(screen.getByLabelText('Display order'))
    await user.type(screen.getByLabelText('Display order'), '4')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith('preview_model_field_evolution', {
        p_definition_id: 'field-1',
        p_action: 'update',
        p_patch: {
          label: 'Sample purity',
          description: 'Measured purity',
          displayOrder: 4,
        },
      }),
    )
    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith('apply_model_field_evolution', {
        p_definition_id: 'field-1',
        p_action: 'update',
        p_patch: {
          label: 'Sample purity',
          description: 'Measured purity',
          displayOrder: 4,
        },
        p_confirm: true,
      }),
    )
  })

  it('creates a governed numeric field through the draft-configure-activate flow', async () => {
    const user = userEvent.setup()
    const { client } = mount(true)
    await screen.findByText('Purity')
    await user.click(screen.getByRole('button', { name: 'Add field' }))

    await user.type(screen.getByLabelText('Label'), 'Concentration')
    await user.type(screen.getByLabelText('Stable key'), 'concentration')
    await user.type(
      screen.getByLabelText('Description'),
      'Measured concentration',
    )
    await user.selectOptions(screen.getByLabelText('Type'), 'decimal')
    await user.type(screen.getByLabelText('Quantity kind'), 'concentration')
    await user.type(screen.getByLabelText('Dimension'), 'mass/volume')
    await user.type(screen.getByLabelText('Storage unit'), 'mg/mL')
    await user.type(screen.getByLabelText('Minimum value'), '0')
    await user.type(screen.getByLabelText('Maximum value'), '100')
    await user.click(screen.getByRole('button', { name: 'Add and activate' }))

    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith(
        'create_model_field',
        expect.objectContaining({
          p_field_name: 'concentration',
          p_description: 'Measured concentration',
          p_validation: { min: 0, max: 100 },
          p_unit: { symbol: 'mg/mL' },
        }),
      ),
    )
    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith(
        'configure_model_field_semantics',
        {
          p_definition_id: 'field-new',
          p_quantity: {
            kind: 'concentration',
            dimension: 'mass/volume',
            storageUnit: 'mg/mL',
            allowedInputUnits: [],
            preferredDisplayUnit: undefined,
          },
          p_cardinality: 'one',
          p_category_source: null,
          p_relationship: null,
        },
      ),
    )
    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith('activate_model_field', {
        p_definition_id: 'field-new',
      }),
    )
    expect(client.rpc).not.toHaveBeenCalledWith(
      'create_and_activate_model_field',
      expect.anything(),
    )
  })

  it('creates a vocabulary-backed category without embedded options', async () => {
    const user = userEvent.setup()
    const { client } = mount(true)
    await screen.findByText('Purity')
    await user.click(screen.getByRole('button', { name: 'Add field' }))

    await user.type(screen.getByLabelText('Label'), 'Therapeutic area')
    await user.type(screen.getByLabelText('Stable key'), 'therapeutic_area')
    await user.selectOptions(screen.getByLabelText('Type'), 'category')
    await user.selectOptions(screen.getByLabelText('Category source'), 'vocabulary')
    await user.type(screen.getByLabelText('Vocabulary ID'), 'therapeutic-area-v1')
    await user.click(screen.getByRole('button', { name: 'Add and activate' }))

    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith(
        'configure_model_field_semantics',
        expect.objectContaining({
          p_definition_id: 'field-new',
          p_category_source: {
            kind: 'vocabulary',
            vocabularyId: 'therapeutic-area-v1',
          },
        }),
      ),
    )
    expect(client.rpc).not.toHaveBeenCalledWith(
      'create_model_field_option',
      expect.anything(),
    )
  })
  it('surfaces kernel validation inline before adding a category field', async () => {
    const user = userEvent.setup()
    mount(true)
    await screen.findByText('Purity')
    await user.click(screen.getByRole('button', { name: 'Add field' }))

    await user.type(screen.getByLabelText('Label'), 'Therapeutic area')
    await user.type(screen.getByLabelText('Stable key'), 'therapeutic_area')
    await user.selectOptions(screen.getByLabelText('Type'), 'category')
    expect(await screen.findByText('Resolve before adding')).toBeTruthy()
    expect(screen.getByText(/needs an active option/)).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Add and activate' })
        .hasAttribute('disabled'),
    ).toBe(true)

    await user.type(
      screen.getByLabelText('Options, separated by commas'),
      'oncology, cardio',
    )
    await waitFor(() =>
      expect(screen.queryByText('Resolve before adding')).toBeNull(),
    )
    expect(screen.getByText(/Field contract valid/)).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Add and activate' })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('rejects a duplicate stable key before submit', async () => {
    const user = userEvent.setup()
    mount(true)
    await screen.findByText('Purity')
    await user.click(screen.getByRole('button', { name: 'Add field' }))

    await user.type(screen.getByLabelText('Label'), 'Purity copy')
    await user.type(screen.getByLabelText('Stable key'), 'purity')

    expect(await screen.findByText('Resolve before adding')).toBeTruthy()
    expect(screen.getByText(/already in use/)).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Add and activate' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('previews impact and confirms retire through the evolution gate', async () => {
    const user = userEvent.setup()
    const { client } = mount(true)
    await screen.findByText('Purity')

    await user.click(screen.getByRole('button', { name: 'Retire' }))
    expect(
      await screen.findByRole('dialog', { name: 'Retire Purity' }),
    ).toBeTruthy()
    expect(await screen.findByText(/migration-requiring/)).toBeTruthy()
    expect(screen.getByText('Dependency impact')).toBeTruthy()
    expect(
      screen.getByText('3 records · informational · informational'),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Preview Purity in Records' }),
    ).toHaveProperty('href', expect.stringContaining('/samples'))

    await user.click(screen.getByRole('button', { name: 'Confirm retire' }))
    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith('preview_model_field_evolution', {
        p_definition_id: 'field-1',
        p_action: 'retire',
        p_patch: {},
      }),
    )
    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith('apply_model_field_evolution', {
        p_definition_id: 'field-1',
        p_action: 'retire',
        p_patch: {},
        p_confirm: true,
      }),
    )
  })

  it('shows the per-model impact report before retire or update', async () => {
    const { client } = mount(true)
    await screen.findByText('Purity')
    expect(
      await screen.findByRole('region', { name: 'Model impact' }),
    ).toBeTruthy()
    expect(screen.getByText('Fields')).toBeTruthy()
    expect(screen.getByText('Records & host rows')).toBeTruthy()
    expect(screen.getByText('Relationship rules')).toBeTruthy()
    expect(screen.getByText('Sheets')).toBeTruthy()
    expect(screen.getByText('Templates')).toBeTruthy()
    expect(
      screen.getByText('Assay plate · active · requires_migration'),
    ).toBeTruthy()
    expect(
      screen.getByText('pk_study v1 · active · requires_migration'),
    ).toBeTruthy()
    expect(
      screen.getByText('sample → batch (0–∞) · active · requires_migration'),
    ).toBeTruthy()
    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith('discover_model_dependencies', {
        p_model_key: 'sample',
      }),
    )
  })

  it('names migration guidance and consequences before confirming retire', async () => {
    const user = userEvent.setup()
    mount(true)
    await screen.findByText('Purity')

    await user.click(screen.getByRole('button', { name: 'Retire' }))
    expect(
      await screen.findByRole('dialog', { name: 'Retire Purity' }),
    ).toBeTruthy()
    expect(
      await screen.findByText(/carry a value for "Purity"/),
    ).toBeTruthy()
    // Named consequences: the dialog counts the listed consumers and the
    // confirm stays explicit about them.
    expect(await screen.findByText(/for the 1 consumer/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Confirm retire' }),
    ).toBeTruthy()
  })

  it('links field rows out to the Records preview', async () => {
    mount(true)
    await screen.findByText('Purity')
    expect(
      screen.getByRole('link', { name: 'Preview Purity in Records' }),
    ).toHaveProperty('href', expect.stringContaining('/samples'))
  })
})

describe('AdminModelFields relationships', () => {
  function rulesClient(rules: unknown[]): DataClient {
    const client = fakeClient()
    client.list = (async (resource: string) => {
      if (resource === 'model_relationship_rules') return rules
      if (resource === 'model_kinds')
        return [
          { key: 'sample', label: 'Samples', identity_table: 'api.records' },
          { key: 'batch', label: 'Batches', identity_table: 'api.records' },
        ]
      if (resource === 'model_base_fields') return []
      if (resource === 'record_field_definitions') return []
      if (resource === 'model_field_options') return []
      throw new Error(`Unexpected list request: ${resource}`)
    }) as DataClient['list']
    client.rpc = vi.fn(async () => ({})) as DataClient['rpc']
    return client
  }

  function mountWith(client: DataClient) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <AdminModelFields
          client={client}
          workspaceId="workspace-1"
          canManage
          selectedModelKey="sample"
        />
      </QueryClientProvider>,
    )
    return { client }
  }

  it('declares the closed world when no rules exist', async () => {
    mountWith(rulesClient([]))
    expect(
      await screen.findByText(/accept every link type/),
    ).toBeTruthy()
  })

  it('lists declared rules with bounds and labels', async () => {
    mountWith(
      rulesClient([
        {
          id: 'rule-1',
          source_model_key: 'sample',
          link_type: 'sample',
          target_model_key: 'sample',
          min_links: 1,
          max_links: 8,
          label: 'consumes',
        },
      ]),
    )
    expect(await screen.findByText(/consumes/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove sample to sample' })).toBeTruthy()
  })

  it('saves a relationship through the configure RPC', async () => {
    const user = userEvent.setup()
    const { client } = mountWith(rulesClient([]))
    await screen.findByText(/accept every link type/)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Target model' }), 'batch')
    await user.click(screen.getByRole('button', { name: 'Save relationship' }))
    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith('configure_model_relationship_rule', {
        p_workspace_id: 'workspace-1',
        p_source_model_key: 'sample',
        p_link_type: 'sample',
        p_target_model_key: 'batch',
        p_min_links: 0,
        p_max_links: null,
        p_label: null,
      }),
    )
  })

  it('removes a relationship through the remove RPC', async () => {
    const user = userEvent.setup()
    const { client } = mountWith(
      rulesClient([
        {
          id: 'rule-1',
          source_model_key: 'sample',
          link_type: 'sample',
          target_model_key: 'sample',
          min_links: 0,
          max_links: null,
          label: null,
        },
      ]),
    )
    await user.click(await screen.findByRole('button', { name: 'Remove sample to sample' }))
    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith('remove_model_relationship_rule', {
        p_rule_id: 'rule-1',
      }),
    )
  })
})
