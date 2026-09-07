/**
 * VIEW-02 plate_map block preview tests. Verifies the PlateMapBlockPreview
 * renders inside the shared representation frame (Live vs Snapshot badge),
 * resolves well→record links honestly (active/archived/missing), surfaces
 * linked-record context on well click with a stable-ID open action, and —
 * in frozen mode — reconstructs the pinned spec with no live reads.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { BlockPreview } from './block-preview'
import type { NotebookBlock } from '#/lib/notebook-data'
import { fetchRecordById } from '#/lib/scientific-records'
import type * as ScientificRecords from '#/lib/scientific-records'
import type { PlateMapSpec } from '#/lib/plate-map'
import { PLATE_MAP_SPEC_VERSION } from '#/lib/plate-map'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children?: ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('#/lib/scientific-records', async (importOriginal) => {
  const actual = await importOriginal<typeof ScientificRecords>()
  return { ...actual, fetchRecordById: vi.fn() }
})

const mockFetchRecordById = fetchRecordById as unknown as Mock

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const RECORD_ID = '00000000-0000-4000-8000-000000000991'

function specWithSample(): PlateMapSpec {
  return {
    specVersion: PLATE_MAP_SPEC_VERSION,
    format: '96_well',
    rows: 8,
    cols: 12,
    wells: [
      {
        wellCode: 'A1',
        row: 0,
        col: 0,
        role: 'sample',
        sampleRef: {
          recordId: RECORD_ID,
          identifier: 'SMP-991',
          title: 'Assay sample',
        },
        replicate: 1,
      },
    ],
    validation: {},
  }
}

function makeBlock(payload: Record<string, unknown>): NotebookBlock {
  return {
    id: 'block-plate',
    recordId: 'experiment-1',
    type: 'plate_map',
    payload,
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  }
}

describe('PlateMapBlockPreview — live representation', () => {
  it('renders inside a live frame and resolves the linked sample', async () => {
    mockFetchRecordById.mockResolvedValue({ id: RECORD_ID, archivedAt: null })
    renderWithQuery(
      <BlockPreview
        block={makeBlock({ title: 'Titration plate', spec: specWithSample() })}
      />,
    )
    expect(screen.getByText('Titration plate')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
    await waitFor(() => {
      expect(mockFetchRecordById).toHaveBeenCalledWith(
        expect.anything(),
        RECORD_ID,
      )
    })
    // Canonical open affordance carries the stable record ID.
    const sampleLink = screen.getByRole('link', { name: 'SMP-991' })
    expect(sampleLink.getAttribute('href')).toContain(RECORD_ID)
  })

  it('selects a well to show linked-record context with an open action', async () => {
    mockFetchRecordById.mockResolvedValue({ id: RECORD_ID, archivedAt: null })
    const user = userEvent.setup()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({ title: 'Titration plate', spec: specWithSample() })}
      />,
    )
    await waitFor(() => {
      expect(mockFetchRecordById).toHaveBeenCalled()
    })
    await user.click(screen.getByRole('button', { name: /A1 · Sample/ }))
    expect(screen.getByText(/Well A1/)).toBeTruthy()
    expect(screen.getByText(/Replicate 1/)).toBeTruthy()
    const open = screen.getByRole('link', { name: 'Open sample record' })
    expect(open.getAttribute('href')).toContain(RECORD_ID)
  })

  it('marks archived samples honestly', async () => {
    mockFetchRecordById.mockResolvedValue({
      id: RECORD_ID,
      archivedAt: '2026-02-01T00:00:00Z',
    })
    const user = userEvent.setup()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({ title: 'Titration plate', spec: specWithSample() })}
      />,
    )
    await waitFor(() => {
      expect(mockFetchRecordById).toHaveBeenCalled()
    })
    await user.click(screen.getByRole('button', { name: /A1 · Sample/ }))
    expect(screen.getByText(/archived/)).toBeTruthy()
  })

  it('marks unresolvable samples as missing without hiding the snapshot', async () => {
    mockFetchRecordById.mockResolvedValue(null)
    const user = userEvent.setup()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({ title: 'Titration plate', spec: specWithSample() })}
      />,
    )
    await waitFor(() => {
      expect(mockFetchRecordById).toHaveBeenCalled()
    })
    await user.click(screen.getByRole('button', { name: /A1 · Sample/ }))
    expect(screen.getByText(/missing — deleted or inaccessible/)).toBeTruthy()
    // The stored observation stays visible even though the record is gone.
    expect(screen.getByRole('link', { name: 'SMP-991' })).toBeTruthy()
  })

  it('prompts for configuration on an empty draft', () => {
    renderWithQuery(<BlockPreview block={makeBlock({})} />)
    expect(screen.getByText(/No plate map configured/)).toBeTruthy()
    expect(mockFetchRecordById).not.toHaveBeenCalled()
  })
})

describe('PlateMapBlockPreview — frozen reconstruction', () => {
  it('renders the pinned spec with no live reads', async () => {
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Submitted plate',
          spec: specWithSample(),
        })}
        frozen
      />,
    )
    expect(screen.getByText('Submitted plate')).toBeTruthy()
    expect(screen.getByText('Snapshot')).toBeTruthy()
    expect(screen.queryByText('Live')).toBeNull()
    // No live record reads in historical mode — not even after settling.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /A1 · Sample/ })).toBeTruthy()
    })
    expect(mockFetchRecordById).not.toHaveBeenCalled()
  })

  it('selects wells from snapshot state in frozen mode', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Submitted plate',
          spec: specWithSample(),
        })}
        frozen
      />,
    )
    await user.click(screen.getByRole('button', { name: /A1 · Sample/ }))
    expect(screen.getByText(/Well A1/)).toBeTruthy()
    expect(screen.getByText(/active \(snapshot\)/)).toBeTruthy()
    expect(mockFetchRecordById).not.toHaveBeenCalled()
  })
})
