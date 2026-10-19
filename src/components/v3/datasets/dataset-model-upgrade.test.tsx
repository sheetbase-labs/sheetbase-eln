import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DatasetModelUpgrade } from './dataset-model-upgrade'

const mocks = vi.hoisted(() => ({
  position: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))
vi.mock('#/lib/dataset-model-upgrade', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchDatasetModelPosition: (...a: unknown[]) => mocks.position(...a),
  previewDatasetModelUpgrade: (...a: unknown[]) => mocks.preview(...a),
  applyDatasetModelUpgrade: (...a: unknown[]) => mocks.apply(...a),
}))

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
  rowCount: 2,
  datasetRevision: 4,
}

function mount(canEdit = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DatasetModelUpgrade datasetId="d1" canEdit={canEdit} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DatasetModelUpgrade', () => {
  it('stays out of the way when the dataset is current or the viewer cannot edit', async () => {
    mocks.position.mockResolvedValue({ ...POSITION, newer: [] })
    mount()
    await waitFor(() => expect(mocks.position).toHaveBeenCalled())
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    mocks.position.mockResolvedValue(POSITION)
    mount(false)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('previews, then applies against the revision it read', async () => {
    const user = userEvent.setup()
    mocks.position.mockResolvedValue(POSITION)
    mocks.preview.mockResolvedValue(PREVIEW)
    mocks.apply.mockResolvedValue({ ...PREVIEW, applied: true })
    mount()
    await user.click(
      await screen.findByRole('button', { name: 'Model v2 available' }),
    )
    expect(await screen.findByText(/Adds Notes/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Upgrade to v2' }))
    await waitFor(() =>
      expect(mocks.apply).toHaveBeenCalledWith(
        {},
        { datasetId: 'd1', targetVersionId: 'v2', expectedRevision: 4 },
      ),
    )
  })

  it('names why a blocked version cannot be applied', async () => {
    const user = userEvent.setup()
    mocks.position.mockResolvedValue(POSITION)
    mocks.preview.mockResolvedValue({
      ...PREVIEW,
      ok: false,
      blocked: true,
      reason: 'The newer version drops fields this dataset holds values for.',
    })
    mount()
    await user.click(
      await screen.findByRole('button', { name: 'Model v2 available' }),
    )
    expect(await screen.findByText(/drops fields/)).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Upgrade to v2' })
        .disabled,
    ).toBe(true)
  })
})
