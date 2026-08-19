import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotebookRecord } from '#/lib/notebook-data'

import { DuplicateNotebookDialog } from './duplicate-notebook-dialog'

vi.mock('#/lib/notebook-experience', async (importOriginal) => ({
  ...(await importOriginal()),
  duplicateExperiment: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const source: NotebookRecord = {
  id: 'r1',
  projectId: 'p1',
  kind: 'experiment',
  identifier: 'EXP-2026-0001',
  title: 'Stability run',
  status: 'in-progress',
  tags: [],
  structureVersion: 1,
  metadataVersion: 1,
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'u1',
  updatedByUserId: null,
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
}

function renderDialog(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('DuplicateNotebookDialog', () => {
  it('defaults the title and duplicates the Notebook', async () => {
    const { duplicateExperiment } = await import('#/lib/notebook-experience')
    const { notebookDataClient } = await import('#/lib/notebook-data')
    const copied: NotebookRecord = {
      ...source,
      id: 'r2',
      title: 'Stability run copy',
    }
    vi.mocked(duplicateExperiment).mockResolvedValue({ record: copied })
    const onDuplicated = vi.fn()
    const user = userEvent.setup()
    renderDialog(
      <DuplicateNotebookDialog
        open
        onOpenChange={vi.fn()}
        source={source}
        blocks={[]}
        onDuplicated={onDuplicated}
      />,
    )
    expect(screen.getByLabelText('Notebook title')).toHaveProperty(
      'value',
      'Stability run copy',
    )
    await user.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(duplicateExperiment).toHaveBeenCalledWith(notebookDataClient, {
      source,
      blocks: [],
      title: 'Stability run copy',
    })
    expect(onDuplicated).toHaveBeenCalledWith(copied)
  })
})
