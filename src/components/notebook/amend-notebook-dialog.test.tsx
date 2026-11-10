import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AmendNotebookDialog } from './amend-notebook-dialog'
import { workspaceGeneralQueryKey } from '#/lib/workspace-general'
import type { WorkspaceGeneral } from '#/lib/workspace-general'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

beforeEach(() => {
  transport.mockReset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })

  client.setQueryData(workspaceGeneralQueryKey, {
    name: 'Lab',
    site: null,
    timezone: 'UTC',
    dateFormat: 'yyyy-MM-dd',
    numberFormat: 'decimal',
    publicationApprovalRequired: false,
    offlineEditingAllowed: false,
    requireChangeReason: true,
    lockOnSign: true,
    regulatedLab: false,
    specLimitsEnabled: false,
    retentionEnabled: false,
    idPrefixes: {},
  } satisfies WorkspaceGeneral)

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('AmendNotebookDialog', () => {
  it('starts an amendment with the reason given', async () => {
    transport.mockResolvedValue(
      Response.json({
        revisionId: 'rev-new',
        supersedesRevisionId: 'rev-old',
        recordId: 'r1',
        integrityDigest: 'abc',
        unlockedAt: '2026-08-19T00:00:00.000Z',
      }),
    )
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
    await user.type(
      screen.getByLabelText('Reason for the amendment'),
      'Protocol tweak',
    )
    await user.click(screen.getByRole('button', { name: 'Confirm amendment' }))
    expect(transport).toHaveBeenCalledWith(
      '/api/db/rpc/create_amendment',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ p_record_id: 'r1', p_note: 'Protocol tweak' }),
      }),
    )
    await waitFor(() => expect(onAmended).toHaveBeenCalled())
  })

  it('keeps the confirm action off until a reason is given', async () => {
    const user = userEvent.setup()
    renderDialog(
      <AmendNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        onAmended={vi.fn()}
      />,
    )
    const confirm = screen.getByRole('button', { name: 'Confirm amendment' })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    await user.type(screen.getByLabelText('Reason for the amendment'), '   ')
    expect(confirm.hasAttribute('disabled')).toBe(true)
    expect(transport).not.toHaveBeenCalled()
  })

  it('shows the DataClientError message when amendment fails', async () => {
    transport.mockResolvedValue(
      Response.json(
        { code: 'forbidden', message: 'You cannot amend this Notebook.' },
        { status: 403 },
      ),
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
    await user.type(
      screen.getByLabelText('Reason for the amendment'),
      'Wrong buffer',
    )
    await user.click(screen.getByRole('button', { name: 'Confirm amendment' }))
    expect(
      await screen.findByText('You cannot amend this Notebook.'),
    ).toBeTruthy()
    expect(screen.queryByText(/create_amendment/i)).toBeNull()
    expect(screen.queryByText(/locked_by_revision_id/i)).toBeNull()
  })
})
