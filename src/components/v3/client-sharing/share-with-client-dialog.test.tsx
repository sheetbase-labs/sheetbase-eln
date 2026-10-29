import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RecordSharing } from '#/lib/client-sharing'
import { ShareWithClientDialog } from './share-with-client-dialog'

const mocks = vi.hoisted(() => ({
  fetchRecordSharing: vi.fn(),
  shareRecordWithClient: vi.fn(),
  unshareRecordWithClient: vi.fn(),
}))

vi.mock('#/lib/client-sharing', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRecordSharing: mocks.fetchRecordSharing,
  shareRecordWithClient: mocks.shareRecordWithClient,
  unshareRecordWithClient: mocks.unshareRecordWithClient,
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

const base: RecordSharing = {
  recordStatus: 'approved',
  projectId: 'p1',
  clientId: 'c1',
  clientCode: 'CL-017',
  clientName: 'AAV Vector Partners',
  autoShare: false,
  sharedAt: null,
  sharedByName: null,
  canManage: true,
}

function renderDialog(sharing: RecordSharing) {
  mocks.fetchRecordSharing.mockResolvedValue(sharing)
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ShareWithClientDialog
        open
        onOpenChange={() => undefined}
        recordId="r1"
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.shareRecordWithClient.mockResolvedValue(undefined)
  mocks.unshareRecordWithClient.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('ShareWithClientDialog', () => {
  it('shares an approved record with the client of its project', async () => {
    renderDialog(base)
    const share = await screen.findByRole('button', { name: 'Share' })
    await waitFor(() =>
      expect((share as HTMLButtonElement).disabled).toBe(false),
    )
    await userEvent.click(share)
    await waitFor(() =>
      expect(mocks.shareRecordWithClient).toHaveBeenCalledWith(
        expect.anything(),
        { clientId: 'c1', recordId: 'r1' },
      ),
    )
  })

  it('says why a record that is not approved cannot be shared yet', async () => {
    renderDialog({ ...base, recordStatus: 'in_progress' })
    expect(await screen.findByText('Not approved yet')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Share' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('explains a project with no client instead of offering a client list', async () => {
    renderDialog({
      ...base,
      clientId: null,
      clientCode: null,
      clientName: null,
    })
    expect(
      await screen.findByText('This record’s project has no client'),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Share' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('offers to stop sharing a record that was shared by hand', async () => {
    renderDialog({
      ...base,
      sharedAt: '2026-10-20T09:00:00Z',
      sharedByName: 'Gareth P.',
    })
    await userEvent.click(
      await screen.findByRole('button', { name: 'Stop sharing' }),
    )
    await waitFor(() =>
      expect(mocks.unshareRecordWithClient).toHaveBeenCalledWith(
        expect.anything(),
        { clientId: 'c1', recordId: 'r1' },
      ),
    )
  })

  it('does not offer to stop an automatic share', async () => {
    renderDialog({ ...base, autoShare: true, sharedAt: '2026-10-20T09:00:00Z' })
    expect(
      await screen.findByText(/shared with the client automatically/),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop sharing' })).toBeNull()
  })
})
