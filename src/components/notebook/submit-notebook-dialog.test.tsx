import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SubmitNotebookDialog } from './submit-notebook-dialog'

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  previewSubmissionDigest: vi.fn(),
  submitRecordRevision: vi.fn(),
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
  it('requires a digest preview before submit', async () => {
    const { previewSubmissionDigest } = await import('#/lib/notebook-data')
    vi.mocked(previewSubmissionDigest).mockResolvedValue({
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 1,
      metadataVersion: 1,
      calculationInputRevision: 1,
    })
    const user = userEvent.setup()
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Submit and freeze' }),
    ).toHaveProperty('disabled', true)
    await user.click(screen.getByRole('button', { name: 'Preview digest' }))
    expect(
      await screen.findByText(/Evidence digest: abc123digest/),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Submit and freeze' }),
    ).toHaveProperty('disabled', false)
  })
})
