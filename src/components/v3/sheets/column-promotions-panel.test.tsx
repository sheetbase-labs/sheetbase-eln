import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApprovalRequest } from '#/lib/approval-requests'
import {
  ColumnPromotionsPanel,
  promotionNextStep,
} from './column-promotions-panel'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  apply: vi.fn(),
  approve: vi.fn(),
  navigate: vi.fn(),
  index: { data: undefined as object | undefined },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mocks.navigate,
}))
vi.mock('#/lib/schema-evolution', () => ({
  listOpenColumnPromotions: (...a: unknown[]) => mocks.list(...a),
  applyColumnPromotion: (...a: unknown[]) => mocks.apply(...a),
}))
vi.mock('#/lib/approval-requests', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approveApprovalRequest: (...a: unknown[]) => mocks.approve(...a),
}))
vi.mock('#/components/v3/models/model-approval-data', () => ({
  useModelApprovalIndex: () => ({ data: mocks.index.data }),
}))
vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {},
  formatNotebookDateTime: (iso: string) => iso.slice(0, 10),
}))
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: () => 'Ada' }),
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

const PROMO = '00000000-0000-4000-8000-0000000000a1'
const SHEET = '00000000-0000-4000-8000-0000000000b1'
const ASKER = 'user-asker'
const STEWARD = 'user-steward'

function request(over: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'req-1',
    workspace_id: 'ws',
    object_kind: 'column_promotion',
    object_id: PROMO,
    object_revision: null,
    required_approver_roles: ['steward'],
    required_approvals: 1,
    require_independence: true,
    state: 'pending',
    reason: null,
    decision_reason: null,
    approved_by_user_ids: [],
    submitted_by_user_id: ASKER,
    submitted_at: '2026-01-01T00:00:00Z',
    decided_by_user_id: null,
    decided_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function promotion() {
  return {
    id: PROMO,
    sheet_instance_id: SHEET,
    field_id: 'f1',
    target: 'dataset_schema',
    schema_definition_id: null,
    schema_version_id: 'sv',
    model_key: null,
    state: 'pending',
    approval_request_id: 'req-1',
    reason: 'Share the readings',
    requested_by_user_id: ASKER,
    requested_at: '2026-01-01T00:00:00Z',
    decided_at: null,
  }
}

function withRequests(requests: ApprovalRequest[]) {
  mocks.index.data = { byVersion: new Map([[PROMO, requests]]) }
}

function mount(user: string, role: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ColumnPromotionsPanel role={role} user={{ id: user, name: user }} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.list.mockResolvedValue([promotion()])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('promotionNextStep', () => {
  it('lets an independent steward decide and makes the asker wait', () => {
    const pending = request({})
    expect(promotionNextStep(pending, STEWARD, 'steward', ASKER)).toBe('decide')
    expect(promotionNextStep(pending, ASKER, 'steward', ASKER)).toBe('waiting')
  })
  it('offers apply after approval and settle after a return', () => {
    expect(
      promotionNextStep(
        request({ state: 'approved' }),
        ASKER,
        'scientist',
        ASKER,
      ),
    ).toBe('apply')
    expect(
      promotionNextStep(
        request({ state: 'returned' }),
        ASKER,
        'scientist',
        ASKER,
      ),
    ).toBe('settle')
    expect(promotionNextStep(null, ASKER, 'scientist', ASKER)).toBe('none')
  })
})

describe('ColumnPromotionsPanel', () => {
  it('names who must decide when the viewer cannot', async () => {
    withRequests([request({})])
    mount(ASKER, 'scientist')
    expect(await screen.findByText(/Waiting for Steward/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('lets the steward approve', async () => {
    const user = userEvent.setup()
    mocks.approve.mockResolvedValue(request({ state: 'approved' }))
    withRequests([request({})])
    mount(STEWARD, 'steward')
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.click(screen.getAllByRole('button', { name: 'Approve' }).at(-1)!)
    await waitFor(() => expect(mocks.approve).toHaveBeenCalled())
    expect(mocks.approve.mock.calls[0][1]).toBe('req-1')
  })

  it('applies an approved promotion and lands on the dataset', async () => {
    const user = userEvent.setup()
    mocks.apply.mockResolvedValue({ applied: true, datasetId: 'ds-7' })
    withRequests([request({ state: 'approved' })])
    mount(ASKER, 'scientist')
    await user.click(
      await screen.findByRole('button', { name: 'Apply promotion' }),
    )
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/datasets/ds-7' }),
    )
  })
})
