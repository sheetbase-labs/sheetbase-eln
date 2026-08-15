import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ConfigurationWorkspace,
  configurationRoleCopy,
} from './configuration-workspace'
import type { DataClient } from '#/lib/data-client'

afterEach(cleanup)

function fakeClient(): DataClient {
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
      return []
    }) as DataClient['list'],
    rpc: vi.fn(async () => ({ dependencies: [] })) as DataClient['rpc'],
    count: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    remove: vi.fn(),
  }
}

function mount(role: 'scientist' | 'steward' | 'owner') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ConfigurationWorkspace
        client={fakeClient()}
        workspaceId="workspace-1"
        role={role}
        search={{ kind: 'schema', id: 'schema-1', model: undefined }}
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('ConfigurationWorkspace', () => {
  it('explains scientist, steward and owner capability differences', () => {
    expect(configurationRoleCopy('scientist')).toMatch(/Data Steward/)
    expect(configurationRoleCopy('steward')).toMatch(/cannot administer/)
    expect(configurationRoleCopy('owner')).toMatch(/Administration/)
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
})
