/**
 * R5-CONFIG-03 — submitting a Dataset Schema draft for approval from the model
 * editor, and the locked state it produces.
 *
 * The editor's header action raises `submitToken`; the panel owns the dialog,
 * the approver roles, the reason and the RPC. Submission never forks the draft:
 * the request points at the same draft version and its current revision.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockedFunction } from 'vitest'

import { createDataClient } from '#/lib/data-client'
import type { ApprovalRequest } from '#/lib/approval-requests'
import { ModelApprovalPanel } from './model-approval-panel'

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id }),
}))

const DRAFT_ID = '00000000-0000-4000-8000-00000000d001'
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000d002'
const draft = { id: DRAFT_ID, version: 5, revision: 8, lifecycle: 'draft' }

const pending: ApprovalRequest = {
  id: '00000000-0000-4000-8000-00000000d003',
  workspace_id: WORKSPACE_ID,
  object_kind: 'dataset_schema_version',
  object_id: DRAFT_ID,
  object_revision: 8,
  required_approver_roles: ['owner', 'reviewer'],
  required_approvals: 1,
  require_independence: true,
  state: 'pending',
  reason: 'Release the freeze range',
  decision_reason: null,
  approved_by_user_ids: [],
  submitted_by_user_id: 'author',
  submitted_at: '2026-10-11T09:00:00Z',
  decided_by_user_id: null,
  decided_at: null,
  created_at: '2026-10-11T09:00:00Z',
  updated_at: '2026-10-11T09:00:00Z',
}

afterEach(cleanup)

function renderPanel(props: {
  requests: ApprovalRequest[]
  submitToken?: number
  fetcher: MockedFunction<typeof fetch>
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ModelApprovalPanel
        version={draft}
        publishedVersion={4}
        requests={props.requests}
        decisions={[]}
        role="steward"
        user={{ id: 'author', name: 'Author' }}
        workspaceId={WORKSPACE_ID}
        client={createDataClient(props.fetcher)}
        submitToken={props.submitToken}
      />
    </QueryClientProvider>,
  )
  return queryClient
}

describe('Dataset Schema draft approval', () => {
  it('opens the submit dialog for the header action and binds the request to the draft revision', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(pending)))
    const queryClient = renderPanel({ requests: [], submitToken: 1, fetcher })

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('button', { name: 'Submit for approval' }),
    ).toBeDefined()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), {
      target: { value: 'Release the freeze range' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Submit for approval' }),
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      '/api/db/rpc/submit_approval_request',
    )
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      p_workspace_id: WORKSPACE_ID,
      p_object_kind: 'dataset_schema_version',
      p_object_id: DRAFT_ID,
      p_object_revision: 8,
      p_required_approver_roles: ['owner', 'reviewer'],
      p_required_approvals: 1,
      p_reason: 'Release the freeze range',
      p_require_independence: true,
    })
    queryClient.clear()
  })

  it('locks the draft while a request is open and offers no second submission', () => {
    const fetcher = vi.fn<typeof fetch>()
    const queryClient = renderPanel({ requests: [pending], fetcher })

    expect(screen.getAllByText(/Locked while/).length).toBeGreaterThan(0)
    expect(
      screen.getByRole('button', { name: `Withdraw submission` }),
    ).toBeDefined()
    expect(
      screen.queryByRole('button', { name: 'Submit for approval' }),
    ).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
    queryClient.clear()
  })
})
