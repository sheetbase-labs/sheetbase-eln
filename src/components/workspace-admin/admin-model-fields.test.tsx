import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
      if (resource === 'model_field_options') return []
      throw new Error(`Unexpected list request: ${resource}`)
    }) as DataClient['list'],
    rpc: vi.fn(async (name: string) => {
      if (name === 'model_field_usage') return 3
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
    await screen.findByRole('option', { name: 'Samples' })
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

    const label = screen.getByLabelText('Label')
    await user.clear(label)
    await user.type(label, 'Sample purity')
    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), 'Measured purity')
    await user.clear(screen.getByLabelText('Display order'))
    await user.type(screen.getByLabelText('Display order'), '4')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith('update_model_field', {
        p_definition_id: 'field-1',
        p_patch: {
          label: 'Sample purity',
          description: 'Measured purity',
          displayOrder: 4,
        },
      }),
    )
  })

  it('creates a described numeric field with a unit', async () => {
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
    await user.type(screen.getByLabelText('Unit symbol'), 'mg/mL')
    await user.click(screen.getByRole('button', { name: 'Add and activate' }))

    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith(
        'create_and_activate_model_field',
        expect.objectContaining({
          p_field_name: 'concentration',
          p_description: 'Measured concentration',
          p_unit: { symbol: 'mg/mL' },
        }),
      ),
    )
  })
})
