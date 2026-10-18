import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotebookOfflineSurfaces } from './notebook-offline-surfaces'
import { OfflineBanner } from './offline-banner'

const { allowed } = vi.hoisted(() => ({ allowed: { value: true } }))

vi.mock('#/lib/workspace-general', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceGeneral: async () => ({
    offlineEditingAllowed: allowed.value,
  }),
}))
vi.mock('./offline-replay', () => ({
  OfflineReplayRunner: () => <div data-testid="replay-runner" />,
}))
vi.mock('./offline-status', () => ({
  OfflineStatusBanner: ({
    offlineEditingAllowed,
  }: {
    offlineEditingAllowed?: boolean
  }) => (
    <div data-testid="banner" data-allowed={String(offlineEditingAllowed)} />
  ),
}))

afterEach(cleanup)

function renderSurfaces() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NotebookOfflineSurfaces
        store={{} as never}
        scope={{ userId: 'u', recordId: 'r' }}
      />
    </QueryClientProvider>,
  )
}

describe('NotebookOfflineSurfaces (J-SET-08)', () => {
  it('replays drafts and keeps the offline promise when the workspace allows it', async () => {
    allowed.value = true
    renderSurfaces()
    expect(await screen.findByTestId('replay-runner')).toBeTruthy()
    expect(screen.getByTestId('banner').getAttribute('data-allowed')).toBe(
      'true',
    )
  })

  it('stops promising and replaying once an owner turns offline editing off', async () => {
    allowed.value = false
    renderSurfaces()
    await waitFor(() =>
      expect(screen.getByTestId('banner').getAttribute('data-allowed')).toBe(
        'false',
      ),
    )
    expect(screen.queryByTestId('replay-runner')).toBeNull()
  })
})

describe('OfflineBanner with offline editing off', () => {
  it('asks the person to reconnect instead of saying edits are kept', () => {
    render(<OfflineBanner offline offlineEditingAllowed={false} />)
    expect(screen.getByText(/Offline editing is turned off/)).toBeTruthy()
    expect(screen.queryByText(/saved on this device/)).toBeNull()
  })
})
