import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'

import { AmendNotebookDialog } from './amend-notebook-dialog'

vi.mock('#/lib/sign-002', async (importOriginal) => ({
  ...(await importOriginal()),
  createAmendment: vi.fn(),
  sign002DataClient: { rpc: vi.fn() },
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

describe('AmendNotebookDialog', () => {
  it('starts an amendment with an optional note', async () => {
    const { createAmendment, sign002DataClient } =
      await import('#/lib/sign-002')
    vi.mocked(createAmendment).mockResolvedValue({
      revisionId: 'rev-new',
      supersedesRevisionId: 'rev-old',
      recordId: 'r1',
      integrityDigest: 'abc',
      unlockedAt: '2026-08-19T00:00:00.000Z',
    })
    const onAmended = vi.fn()
    const user = userEvent.setup()
    renderDialog(
      <AmendNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        onAmended={onAmended}
      />,
    )
    await user.type(screen.getByLabelText('Amendment note'), 'Protocol tweak')
    await user.click(screen.getByRole('button', { name: 'Confirm amendment' }))
    expect(createAmendment).toHaveBeenCalledWith(sign002DataClient, {
      recordId: 'r1',
      note: 'Protocol tweak',
    })
    expect(onAmended).toHaveBeenCalled()
  })

  it('shows the DataClientError message when amendment fails', async () => {
    const { createAmendment } = await import('#/lib/sign-002')
    vi.mocked(createAmendment).mockRejectedValue(
      new DataClientError('forbidden', 'You cannot amend this Notebook.', 403),
    )
    const user = userEvent.setup()
    renderDialog(
      <AmendNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        onAmended={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Confirm amendment' }))
    expect(
      await screen.findByText('You cannot amend this Notebook.'),
    ).toBeTruthy()
    expect(screen.queryByText(/create_amendment/i)).toBeNull()
    expect(screen.queryByText(/locked_by_revision_id/i)).toBeNull()
  })
})
