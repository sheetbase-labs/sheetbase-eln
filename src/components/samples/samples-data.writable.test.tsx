import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'

import { useWritableProjectNames } from './samples-data'

const EDIT = '00000000-0000-4000-8000-000000000321'
const VIEW = '00000000-0000-4000-8000-000000000322'
const OLD = '00000000-0000-4000-8000-000000000323'

function permissions(projectId: string, canEdit: boolean) {
  return {
    project_id: projectId,
    access_level: canEdit ? 'editor' : 'viewer',
    can_view: true,
    can_edit: canEdit,
    can_review: false,
    client_portal: false,
    can_manage: false,
  }
}

/** A data client over a fetch double that serves three projects and the person's access to them. */
function fakeClient(): DataClient {
  return createDataClient(async (input) => {
    const path = new URL(
      input instanceof Request ? input.url : input.toString(),
      'http://localhost',
    ).pathname

    if (path === '/api/db/projects')
      return Response.json([
        { id: EDIT, title: 'Editable', archived_at: null },
        { id: VIEW, title: 'View only', archived_at: null },
        { id: OLD, title: 'Archived', archived_at: '2026-01-01T00:00:00Z' },
      ])

    return Response.json([
      permissions(EDIT, true),
      permissions(VIEW, false),
      permissions(OLD, true),
    ])
  })
}

describe('useWritableProjectNames', () => {
  it('offers only projects the person can edit and that are not archived', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {children}
      </QueryClientProvider>
    )

    const { result } = renderHook(() => useWritableProjectNames(fakeClient()), {
      wrapper,
    })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect([...(result.current.data ?? new Map()).entries()]).toEqual([
      [EDIT, 'Editable'],
    ])
  })
})
