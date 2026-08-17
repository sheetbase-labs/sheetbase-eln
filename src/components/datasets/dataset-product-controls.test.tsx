import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DatasetCreateDialog } from '#/components/datasets/dataset-product-controls'
import type { DataClient } from '#/lib/data-client'

afterEach(() => cleanup())

function renderDialog(client: DataClient, onCreated = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <DatasetCreateDialog
        open
        onOpenChange={() => {}}
        client={client}
        workspaceId="ws-1"
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  )
  return onCreated
}

describe('DatasetCreateDialog', () => {
  it('creates a Dataset from the selected published Schema Version', async () => {
    const user = userEvent.setup()
    const insert = vi.fn(async () => ({
      id: 'ds-created',
      name: 'HPLC',
      revision: 1,
    }))
    const client = {
      list: async (resource: string) => {
        if (resource === 'dataset_schema_definitions') {
          return [
            {
              id: 'def-1',
              key: 'hplc',
              name: 'HPLC',
              description: null,
              lifecycle: 'active',
            },
          ]
        }
        return [
          {
            id: 'ver-1',
            schema_id: 'def-1',
            version: 1,
            lifecycle: 'active',
            published_at: '2026-01-01',
          },
        ]
      },
      insert,
    } as unknown as DataClient
    const onCreated = renderDialog(client)
    expect(await screen.findByLabelText('Schema Version')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Schema Version'), 'ver-1')
    await user.type(screen.getByLabelText('Dataset name'), 'HPLC')
    await user.click(screen.getByRole('button', { name: 'Create Dataset' }))
    expect(insert).toHaveBeenCalledWith('datasets', {
      workspace_id: 'ws-1',
      schema_version_id: 'ver-1',
      name: 'HPLC',
      description: null,
      primary_project_id: null,
    })
    expect(onCreated).toHaveBeenCalledWith('ds-created')
  })
})
