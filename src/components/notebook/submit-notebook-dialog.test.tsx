import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SubmitNotebookDialog } from './submit-notebook-dialog'
import { fetchWorkspaceMembers } from '#/lib/workspace-admin'

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  previewSubmissionDigest: vi.fn(),
  submitRecordRevision: vi.fn(),
}))

vi.mock('#/lib/workspace-admin', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceMembers: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('SubmitNotebookDialog', () => {
  it('requires a snapshot check and a reviewer before submit', async () => {
    const { previewSubmissionDigest, submitRecordRevision } = await import(
      '#/lib/notebook-data'
    )
    vi.mocked(previewSubmissionDigest).mockResolvedValue({
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 1,
      metadataVersion: 1,
      calculationInputRevision: 1,
    })
    vi.mocked(submitRecordRevision).mockResolvedValue({
      revision: { id: 'rev-1', integrityDigest: 'abc123digest' },
      submission: { id: 'sub-1', state: 'submitted' },
      idempotent: false,
    })
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([
      {
        id: 'm1',
        workspaceId: 'ws',
        userId: 'u1',
        role: 'scientist',
        suspendedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        workspaceId: 'ws',
        userId: '22222222-reviewer',
        role: 'reviewer',
        suspendedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ])
    const user = userEvent.setup()
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
        workspaceId="ws"
      />,
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(await screen.findByText('You (scientist)')).toBeTruthy()
    await user.click(screen.getByText('22222222 · reviewer'))
    await user.click(screen.getByRole('button', { name: 'Check snapshot' }))
    expect(await screen.findByText(/Integrity check: abc123digest/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      false,
    )
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(submitRecordRevision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reviewerUserIds: ['u1', '22222222-reviewer'],
      }),
    )
  })
})
