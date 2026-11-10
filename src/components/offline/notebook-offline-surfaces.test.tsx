import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { NotebookOfflineSurfaces } from './notebook-offline-surfaces'
import { OfflineBanner } from './offline-banner'
import { OfflineEditsProvider } from './offline-edits'
import {
  createInMemoryStorage,
  createOfflineEditStore,
} from '#/lib/offline/store'
import { OFFLINE_SYNC_EVENT } from '#/lib/offline/service-worker'
import { createDataClient } from '#/lib/data-client'
import {
  fetchWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from '#/lib/workspace-general'
import type { OfflineReplayReport } from '#/lib/offline/replay'

afterEach(cleanup)

async function renderSurfaces(allowed: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const requests: string[] = []

  const general = await fetchWorkspaceGeneral(
    createDataClient(async (url) => {
      requests.push(url instanceof Request ? url.url : url.toString())

      return Response.json([
        {
          site: null,
          timezone: 'UTC',
          date_format: 'd MMM yyyy',
          number_format: 'decimal',
          publication_approval_required: false,
          allow_offline_editing: allowed,
          require_change_reason: false,
          lock_on_sign: false,
          regulated_lab: false,
          id_prefixes: {},
          workspaces: { name: 'Lab' },
        },
      ])
    }),
  )

  client.setQueryData([...workspaceGeneralQueryKey, 'offline-gate'], general)
  const store = createOfflineEditStore(createInMemoryStorage())
  const scope = { userId: 'u', recordId: 'r' }
  const reports: OfflineReplayReport[] = []
  render(
    <QueryClientProvider client={client}>
      <OfflineEditsProvider store={store} scope={scope}>
        <NotebookOfflineSurfaces
          store={store}
          scope={scope}
          onReport={(report) => reports.push(report)}
        />
      </OfflineEditsProvider>
    </QueryClientProvider>,
  )

  return { client, reports, requests, store, scope }
}

describe('NotebookOfflineSurfaces (J-SET-08)', () => {
  it('replays drafts and keeps the offline promise when the workspace allows it', async () => {
    const { reports, requests } = await renderSurfaces(true)
    expect(await screen.findByText(/saved on this device/)).toBeTruthy()
    expect(screen.getByText('Available offline')).toBeTruthy()
    await act(async () => {
      window.dispatchEvent(new Event(OFFLINE_SYNC_EVENT))
    })
    await waitFor(() => expect(reports).toHaveLength(1))
    expect(reports[0]).toMatchObject({ committedEditIds: [], failed: [] })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain('/api/db/workspace_settings?select=')
  })

  it('stops promising and replaying once an owner turns offline editing off', async () => {
    const { client, reports, store, scope } = await renderSurfaces(true)
    await act(async () => {
      window.dispatchEvent(new Event(OFFLINE_SYNC_EVENT))
    })
    await waitFor(() => expect(reports).toHaveLength(1))
    await store.putEdit(scope, {
      kind: 'block_text',
      blockId: 'b1',
      text: 'kept draft',
      expectedRevision: 1,
    })
    await act(async () => {
      client.setQueryData([...workspaceGeneralQueryKey, 'offline-gate'], {
        offlineEditingAllowed: false,
      })
    })
    expect(
      await screen.findByText(/Offline editing is turned off/),
    ).toBeTruthy()
    expect(screen.queryByText(/saved on this device/)).toBeNull()
    expect(screen.queryByText('Available offline')).toBeNull()
    await act(async () => {
      window.dispatchEvent(new Event(OFFLINE_SYNC_EVENT))
    })
    expect(reports).toHaveLength(1)
    expect(await store.listEdits(scope)).toMatchObject([{ text: 'kept draft' }])
  })
})

describe('OfflineBanner with offline editing off', () => {
  it('asks the person to reconnect instead of saying edits are kept', () => {
    render(<OfflineBanner offline offlineEditingAllowed={false} />)
    expect(screen.getByText(/Offline editing is turned off/)).toBeTruthy()
    expect(screen.queryByText(/saved on this device/)).toBeNull()
  })
})
