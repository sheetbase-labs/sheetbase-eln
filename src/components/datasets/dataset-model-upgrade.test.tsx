import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDataClient } from '#/lib/data-client'
import { datasetModelPositionKey } from './dataset-model-upgrade-data'
import { DatasetModelUpgrade } from './dataset-model-upgrade'

const POSITION = {
  datasetRevision: 4,
  currentVersionId: 'v1',
  currentVersion: 1,
  newer: [{ id: 'v2', version: 2 }],
}

const PREVIEW = {
  ok: true,
  blocked: false,
  reason: null,
  fromVersion: 1,
  toVersion: 2,
  toVersionId: 'v2',
  added: [{ key: 'notes', label: 'Notes', type: 'text' }],
  removed: [],
  retyped: [],
  requiredWithoutDefault: [],
  semanticChanges: [],
  rowCount: 2,
  datasetRevision: 4,
}

function mount({
  canEdit = true,
  newer = POSITION.newer,
  preview = Response.json(PREVIEW),
  apply = Response.json({ ...PREVIEW, applied: true }),
} = {}) {
  const transport = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'http://localhost',
    )

    switch (url.pathname) {
      case '/api/db/datasets':
        return Response.json([{ revision: 4, schema_version_id: 'v1' }])
      case '/api/db/dataset_schema_versions':
        return Response.json(
          url.searchParams.has('schema_id')
            ? newer
            : [{ id: 'v1', schema_id: 'schema', version: 1 }],
        )
      case '/api/db/rpc/preview_dataset_model_upgrade':
        return preview.clone()
      case '/api/db/rpc/apply_dataset_model_upgrade':
        return apply.clone()
      default:
        throw new Error(`Unexpected request: ${url}`)
    }
  })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  queryClient.setQueryData(['dataset-explorer', 'test'], [])
  render(
    <QueryClientProvider client={queryClient}>
      <DatasetModelUpgrade
        datasetId="d1"
        canEdit={canEdit}
        client={createDataClient(transport)}
      />
    </QueryClientProvider>,
  )

  return { transport, queryClient }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DatasetModelUpgrade', () => {
  it('stays out of the way when the dataset is current or the viewer cannot edit', async () => {
    const { queryClient } = mount({ newer: [] })
    await waitFor(() =>
      expect(queryClient.getQueryData(datasetModelPositionKey('d1'))).toEqual({
        ...POSITION,
        newer: [],
      }),
    )
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    mount({ canEdit: false })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('previews, then applies against the revision it read', async () => {
    const user = userEvent.setup()
    const { transport, queryClient } = mount()
    await user.click(
      await screen.findByRole('button', { name: 'Version 2 available' }),
    )
    expect(await screen.findByText(/Adds Notes/)).toBeTruthy()
    await user.click(
      screen.getByRole('button', { name: 'Upgrade to version 2' }),
    )
    await waitFor(() =>
      expect(transport).toHaveBeenCalledWith(
        '/api/db/rpc/apply_dataset_model_upgrade',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            p_dataset_id: 'd1',
            p_target_version_id: 'v2',
            p_expected_revision: 4,
          }),
        }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      queryClient.getQueryState(['dataset-explorer', 'test'])?.isInvalidated,
    ).toBe(true)
    expect(
      transport.mock.calls.filter(
        ([url]) =>
          url === '/api/db/datasets?id=eq.d1&select=revision,schema_version_id',
      ).length,
    ).toBe(2)
  })

  it('names why a blocked version cannot be applied', async () => {
    const user = userEvent.setup()

    const { transport } = mount({
      preview: Response.json({
        ...PREVIEW,
        ok: false,
        blocked: true,
        reason:
          'The newer version changes units. An explicit validated migration is required.',
        semanticChanges: [{ key: 'mass', label: 'Mass' }],
      }),
    })

    await user.click(
      await screen.findByRole('button', { name: 'Version 2 available' }),
    )
    expect(await screen.findByText(/changes units/)).toBeTruthy()
    expect(screen.getByText('Affected fields: Mass.')).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Upgrade to version 2',
      }).disabled,
    ).toBe(true)
    expect(
      transport.mock.calls.some(
        ([url]) => url === '/api/db/rpc/apply_dataset_model_upgrade',
      ),
    ).toBe(false)
  })

  it('refuses to apply when preview fails', async () => {
    mount({
      preview: Response.json({ message: 'Preview refused' }, { status: 403 }),
    })
    await userEvent.click(
      await screen.findByRole('button', { name: 'Version 2 available' }),
    )
    expect(await screen.findByText(/reload the page/i)).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Upgrade to version 2',
      }).disabled,
    ).toBe(true)
  })

  it('keeps the dialog and caches unchanged when applying is refused', async () => {
    const { queryClient } = mount({
      apply: Response.json(
        { message: 'Revision changed', code: 'conflict' },
        { status: 409 },
      ),
    })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Version 2 available' }),
    )
    await screen.findByText(/Adds Notes/)
    await userEvent.click(
      screen.getByRole('button', { name: 'Upgrade to version 2' }),
    )
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Revision changed',
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(
      queryClient.getQueryState(['dataset-explorer', 'test'])?.isInvalidated,
    ).toBe(false)
  })
})
