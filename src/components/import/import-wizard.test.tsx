import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ImportWizard } from '#/components/import/import-wizard'
import type { DataClient } from '#/lib/data-client'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'
import type { ModelFieldDefinition } from '#/lib/model-fields'

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

  it('registers pasted Samples through validation before creating records', async () => {
    const user = userEvent.setup()
    const rpc = vi.fn(async (name: string) => {
      if (name === 'validate_sheet_record_batch') return { ok: true, rows: [] }
      if (name === 'create_model_record') return { id: 'sample-1' }
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
          mode={{
            kind: 'record',
            projectId: 'project-1',
            projects: [{ id: 'project-1', title: 'Purification' }],
            modelKey: 'sample',
            recordKind: 'sample',
            fields: [
              {
                id: 'field-1',
                modelKey: 'sample',
                fieldName: 'species',
                label: 'Species',
                description: null,
                displayOrder: 1,
                logicalType: 'text',
                nullable: true,
                defaultValue: null,
                unit: null,
                quantity: null,
                validation: {},
                cardinality: 'one',
                categorySource: null,
                relationship: null,
                lifecycle: 'active',
                options: [],
              } satisfies ModelFieldDefinition,
            ],
          }}
          onDone={onDone}
        />
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('tab', { name: 'Paste' }))
    await user.type(
      screen.getByLabelText('Import paste'),
      'Record name,Species{enter}Batch 1,Homo sapiens',
    )
    await user.click(screen.getByRole('button', { name: 'Preview paste' }))
    await user.click(
      screen.getByRole('button', { name: 'Validate and commit' }),
    )

    expect(rpc).toHaveBeenCalledWith(
      'validate_sheet_record_batch',
      expect.objectContaining({ p_model_key: 'sample' }),
    )
    expect(rpc).toHaveBeenCalledWith(
      'create_model_record',
      expect.objectContaining({ p_kind: 'sample', p_title: 'Batch 1' }),
    )
    expect(onDone).toHaveBeenCalled()
  })
})

describe('ImportWizard suggested mapping (ASSIST-02)', () => {
  function renderWizard() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ImportWizard
          open
          onOpenChange={() => {}}
          client={{ rpc: vi.fn() } as unknown as DataClient}
          mode={{ kind: 'dataset', table }}
          onDone={() => {}}
        />
      </QueryClientProvider>,
    )
  }

  async function previewCloseMatchPaste() {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('tab', { name: 'Paste' }))
    // 'sampleid' has no exact target: the kernel leaves it ignored, while
    // the suggester offers a close match with a reason.
    await user.type(screen.getByLabelText('Import paste'), 'sampleid,pH{enter}A,7.4')
    await user.click(screen.getByRole('button', { name: 'Preview paste' }))
    expect(await screen.findByText('A')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Suggest mapping' }))
    expect(
      await screen.findByRole('note', { name: 'Generated draft' }),
    ).toBeTruthy()
    return user
  }

  it('previews confidence per column and applies the suggestion on Accept', async () => {
    const user = await previewCloseMatchPaste()
    expect(screen.getByText(/\[close\]/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Accept and apply mapping' }))
    // The suggestion flows through the ordinary mapping selects …
    expect(
      (screen.getByLabelText('Map sampleid') as HTMLSelectElement).value,
    ).toBe('11111111-1111-4111-8111-111111111111')
    // … and the proposal clears.
    expect(screen.queryByRole('note', { name: 'Generated draft' })).toBeNull()
  })

  it('Discard leaves the mapping untouched with zero state', async () => {
    const user = await previewCloseMatchPaste()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(
      (screen.getByLabelText('Map sampleid') as HTMLSelectElement).value,
    ).toBe('ignore')
    expect(screen.queryByRole('note', { name: 'Generated draft' })).toBeNull()
  })
})
