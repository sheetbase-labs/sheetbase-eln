import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ImportWizard } from '#/components/import/import-wizard'
import type { DataClient } from '#/lib/data-client'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'

afterEach(() => cleanup())

const table = {
  id: 'ds-1',
  name: 'Assay',
  schema_version_id: 'ver-1',
  schema_version_number: 1,
  revision: 1,
  columns: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      field_name: 'sample',
      label: 'Sample',
      display_order: 0,
      logical_type: 'text',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [],
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      field_name: 'ph',
      label: 'pH',
      display_order: 1,
      logical_type: 'decimal',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [],
    },
  ],
} as unknown as CanonicalDatasetWire

describe('ImportWizard', () => {
  it('previews a paste, maps columns, and commits through Dataset RPCs', async () => {
    const user = userEvent.setup()
    const rpc = vi.fn(async (name: string) => {
      if (name === 'validate_dataset_row_batch') return { ok: true }
      if (name === 'commit_dataset_row_batch') {
        return { ok: true, datasetRevision: 2, rows: [{ rowId: 'r1' }] }
      }
      throw new Error(name)
    })
    const onDone = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ImportWizard
          open
          onOpenChange={() => {}}
          client={{ rpc } as unknown as DataClient}
          mode={{ kind: 'dataset', table }}
          onDone={onDone}
        />
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('tab', { name: 'Paste' }))
    await user.type(
      screen.getByLabelText('Import paste'),
      'Sample,pH{enter}A,7.4',
    )
    await user.click(screen.getByRole('button', { name: 'Preview paste' }))
    expect(await screen.findByText('A')).toBeTruthy()
    await user.click(
      screen.getByRole('button', { name: 'Validate and commit' }),
    )
    expect(rpc).toHaveBeenCalledWith(
      'validate_dataset_row_batch',
      expect.anything(),
    )
    expect(rpc).toHaveBeenCalledWith(
      'commit_dataset_row_batch',
      expect.anything(),
    )
    expect(onDone).toHaveBeenCalled()
  })
})
