import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { formatDate } from '#/lib/notebook-data'
import type { RevisionWire } from '#/lib/notebook-data'
import { sign002QueryKeys } from '#/lib/sign-002'

import { NotebookHistoryPanel } from './notebook-history-panel'

afterEach(() => {
  cleanup()
})

function renderPanel(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })

  client.setQueryData(sign002QueryKeys.timeline('r1'), [])
  client.setQueryData(['notebook-experience', 'revisions', 'r1'], [revision])

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>{ui}</RouterContextProvider>
    </QueryClientProvider>,
  )
}

const revision: RevisionWire = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  record_id: 'r1',
  structure_version: 1,
  metadata_version: 1,
  metadata_snapshot: {},
  block_snapshot: [],
  reason: 'submit',
  superseded_by_revision_id: null,
  created_at: '2026-07-18T12:00:00.000Z',
  created_by_user_id: 'u1',
}

describe('NotebookHistoryPanel', () => {
  it('renders submitted revisions as canonical record links', async () => {
    renderPanel(
      <NotebookHistoryPanel
        recordId="r1"
        currentUserId="u1"
        currentUserName="Ada"
      />,
    )

    const link = await screen.findByRole('link', {
      name: new RegExp(`Submitted ${formatDate(revision.created_at)}`),
    })

    expect(link.getAttribute('href')).toBe(
      '/records/r1?revision=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    )
    expect(screen.getByText('aaaaaaaa')).toBeTruthy()
  })

  it('uses the same stable destination without project context', async () => {
    renderPanel(
      <NotebookHistoryPanel
        recordId="r1"
        currentUserId="u1"
        currentUserName="Ada"
      />,
    )
    expect(
      (
        await screen.findByRole('link', {
          name: new RegExp(`Submitted ${formatDate(revision.created_at)}`),
        })
      ).getAttribute('href'),
    ).toContain('/records/r1?revision=')
  })
})
