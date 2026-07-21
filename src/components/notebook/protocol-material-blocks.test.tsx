import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import { fetchRecordById } from '#/lib/scientific-records'
import type * as ScientificRecords from '#/lib/scientific-records'
import { BlockEditor } from './block-editor'
import { BlockPreview } from './block-preview'

vi.mock('#/lib/scientific-records', async (importOriginal) => {
  const actual = await importOriginal<typeof ScientificRecords>()
  return { ...actual, fetchRecordById: vi.fn() }
})

const fetchMaterialRecord = vi.mocked(fetchRecordById)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function block(type: NotebookBlock['type'], payload: Record<string, unknown>) {
  return {
    id: `block-${type}`,
    recordId: 'experiment-1',
    type,
    payload,
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  } satisfies NotebookBlock
}

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const procedurePayload = {
  text: 'Mix the standards',
  stepNumber: 2,
  sourceProtocolRevisionId: '10000000-0000-4000-8000-000000000001',
  sourceStepBlockId: '20000000-0000-4000-8000-000000000002',
  completed: false,
  note: '',
  completedAt: null,
  completedByUserId: null,
}

describe('SCI-002 protocol and procedure blocks', () => {
  it('renders a pinned protocol snapshot and an honest empty state', async () => {
    fetchMaterialRecord.mockResolvedValue(
      currentRecord({
        id: 'protocol-1',
        kind: 'protocol_template',
        archivedAt: '2026-07-21T00:00:00Z',
      }),
    )
    const { rerender } = renderWithQuery(
      <BlockPreview
        block={block('protocol_reference', {
          protocolRecordId: 'protocol-1',
          protocolIdentifier: 'PRO-042',
          protocolTitle: 'RNA extraction',
          protocolRevisionId: 'revision-123456789',
          version: '3.2',
          approvalStatus: 'Approved',
          pinnedAt: '2026-07-20T10:00:00.000Z',
          pinnedByUserId: 'user-1',
        })}
      />,
    )

    expect(screen.getByText('RNA extraction')).toBeTruthy()
    expect(screen.getByText(/PRO-042 · revision revision/)).toBeTruthy()
    expect(screen.getByText('Version 3.2')).toBeTruthy()
    expect(screen.getByText('Approved')).toBeTruthy()
    expect(await screen.findByText('Protocol archived')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()

    rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <BlockPreview block={block('protocol_reference', {})} />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/No protocol version pinned/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows incomplete and completed execution observations without controls', () => {
    const { rerender } = renderWithQuery(
      <BlockPreview block={block('procedure_step', procedurePayload)} />,
    )
    expect(screen.getByLabelText('Not completed').textContent).toBe('2')
    expect(screen.getByText('Mix the standards')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <BlockPreview
          block={block('procedure_step', {
            ...procedurePayload,
            completed: true,
            note: 'No precipitate observed',
            completedAt: '2026-07-20T10:15:00.000Z',
            completedByUserId: 'user-1',
          })}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByLabelText('Completed').textContent).toBe('✓')
    expect(screen.getByText('No precipitate observed')).toBeTruthy()
    expect(screen.getByText(/^Completed /)).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keyboard-operates execution completion and note and flushes both saves', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true as const }))
    renderWithQuery(
      <BlockEditor
        block={block('procedure_step', procedurePayload)}
        save={save}
      />,
    )

    const checkbox = screen.getByRole('checkbox')
    checkbox.focus()
    await user.keyboard(' ')
    await user.tab() // checkbox blur flushes the completion change
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const calls = save.mock.calls as unknown as Array<[Record<string, unknown>]>
    expect(calls[0][0]).toMatchObject({ completed: true, note: '' })

    const note = screen.getByRole('textbox', { name: 'Execution note' })
    expect(document.activeElement).toBe(note)
    await user.type(note, 'Observed at bench')
    await user.tab() // note blur bypasses the autosave debounce
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(calls[1][0]).toMatchObject({
      completed: true,
      note: 'Observed at bench',
    })
  })
})

const materialItems = [
  {
    id: 'captured-1',
    materialRecordId: 'record-1',
    kind: 'reagent' as const,
    identifier: 'REA-001',
    title: 'Archived buffer',
    quantity: 12.5,
    unit: { code: 'uL', symbol: 'µL' },
    observedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 'captured-2',
    materialRecordId: 'record-2',
    kind: 'sample' as const,
    identifier: 'SAM-002',
    title: 'Scarce sample',
    quantity: 2,
    unit: { code: 'tube', symbol: 'tubes' },
    observedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 'captured-3',
    materialRecordId: 'record-missing',
    kind: 'reagent' as const,
    identifier: 'REA-003',
    title: 'Missing reagent',
    quantity: 4,
    unit: { code: 'mL', symbol: 'mL' },
    observedAt: '2026-07-01T00:00:00.000Z',
  },
]

function currentRecord(overrides: Partial<NotebookRecord>): NotebookRecord {
  return {
    id: 'record-1',
    projectId: 'project-1',
    kind: 'reagent',
    identifier: 'REA-001',
    title: 'Current title',
    status: 'active',
    properties: {},
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  } as NotebookRecord
}

describe('SCI-002 materials preview', () => {
  it('keeps captured quantity/unit while surfacing current record risks', async () => {
    const records = new Map<string, NotebookRecord>([
      [
        'record-1',
        currentRecord({
          archivedAt: '2026-07-01T00:00:00.000Z',
          status: 'expired',
        }),
      ],
      [
        'record-2',
        currentRecord({
          id: 'record-2',
          kind: 'sample',
          identifier: 'SAM-002',
          status: 'low_stock',
        }),
      ],
    ])
    fetchMaterialRecord.mockImplementation((_client, id) =>
      Promise.resolve(records.get(id) ?? null),
    )
    renderWithQuery(
      <BlockPreview block={block('materials', { items: materialItems })} />,
    )

    expect(screen.getByText('12.5 µL')).toBeTruthy()
    expect(screen.getByText('2 tubes')).toBeTruthy()
    expect(screen.getByText('4 mL')).toBeTruthy()
    expect(await screen.findByText('Archived')).toBeTruthy()
    expect(screen.getByText('Expired')).toBeTruthy()
    expect(screen.getByText('Low stock')).toBeTruthy()
    expect(screen.getByText('Unavailable')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('preserves stored observations while current availability is loading', () => {
    fetchMaterialRecord.mockReturnValue(new Promise(() => {}))
    renderWithQuery(
      <BlockPreview
        block={block('materials', { items: [materialItems[0]] })}
      />,
    )

    expect(screen.getByText('Archived buffer')).toBeTruthy()
    expect(screen.getByText('12.5 µL')).toBeTruthy()
    expect(screen.getByText('Checking availability…')).toBeTruthy()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('preserves stored observations and reports a current-query failure', async () => {
    fetchMaterialRecord.mockRejectedValue(new Error('network unavailable'))
    renderWithQuery(
      <BlockPreview
        block={block('materials', { items: [materialItems[0]] })}
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Current material availability could not be loaded. Stored observations remain visible.',
    )
    expect(screen.getByText('Archived buffer')).toBeTruthy()
    expect(screen.getByText('12.5 µL')).toBeTruthy()
  })
})
