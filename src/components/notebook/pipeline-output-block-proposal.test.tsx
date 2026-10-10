/**
 * PIPE-03 — pipeline proposal block tests.
 *
 * The block renders a run's output and, when a proposal is pinned to it, the
 * proposal with the design's Compare / Accept / Reject actions wired to
 * `decide_agent_operation` and `execute_agent_operation`. The tests pin the
 * honesty rules too: an absent or decided proposal states its state instead of
 * rendering inert controls, and a read-only rendering never offers a decision.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as agentOperations from '#/lib/agent-operations'
import {
  decideAgentOperation,
  executeAgentOperation,
  fetchAgentOperationProposal,
} from '#/lib/agent-operations'
import type { AgentOperationProposal } from '#/lib/agent-operations'
import type * as pipelineData from '#/lib/pipelines/data'
import { PipelineOutputBlockEditor } from './pipeline-output-block-editor'
import { PipelineOutputBlockPreview } from './pipeline-output-block-preview'
import { PROPOSAL_ABSENT_MESSAGE } from './pipeline-output-block-proposal'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    params,
    search,
    ...rest
  }: {
    to?: string
    children?: ReactNode
    params?: unknown
    search?: unknown
    [key: string]: unknown
  }) => (
    <a href={typeof to === 'string' ? to : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('#/lib/agent-operations', async (importOriginal) => {
  const actual = await importOriginal<typeof agentOperations>()
  return {
    ...actual,
    fetchAgentOperationProposal: vi.fn(),
    decideAgentOperation: vi.fn(),
    executeAgentOperation: vi.fn(),
  }
})

vi.mock('#/lib/pipelines/data', async (importOriginal) => {
  const actual = await importOriginal<typeof pipelineData>()
  return {
    ...actual,
    listRecentPipelineRuns: vi.fn(async () => []),
    listPipelineRunOutputs: vi.fn(async () => []),
  }
})

const fetchProposal = vi.mocked(fetchAgentOperationProposal)
const decide = vi.mocked(decideAgentOperation)
const execute = vi.mocked(executeAgentOperation)

const PROPOSAL_ID = '0198d970-e266-4000-8000-0000000000a1'
const RUN_ID = '0198d970-e266-4000-8000-0000000000b1'

function makeProposal(
  overrides: Partial<AgentOperationProposal> = {},
): AgentOperationProposal {
  return {
    id: PROPOSAL_ID,
    workspace_id: 'workspace-1',
    title: 'Add Figure 1 after Figure 1',
    summary: 'A new Figure 1 from DS-0311 snapshot S-15, which adds plate 4.',
    operation_kind: 'dataset_schema.create',
    operation: {
      kind: 'dataset_schema.create',
      workspaceId: 'workspace-1',
      key: 'figure_1',
      name: 'Figure 1',
      fields: [],
    },
    preview: {
      formatVersion: 1,
      kind: 'dataset_schema.create',
      target: { type: 'record', id: RUN_ID, label: 'Figure 1' },
      changes: [
        {
          path: 'blocks.figure-1',
          before: null,
          after: { type: 'chart' },
        },
      ],
    },
    impact: {
      formatVersion: 1,
      mutationClass: 'configuration',
      target: { type: 'record', id: RUN_ID, label: 'Figure 1' },
      createsDraft: true,
      affectedRows: 1,
      destructive: false,
    },
    risk_class: 'safe_draft',
    approval_policy: 'human_required',
    policy_id: null,
    policy_reason: 'A person must approve this change.',
    policy_limits: {},
    policy_target: {},
    policy_evidence: {},
    status: 'pending',
    revision: 1,
    idempotency_key: 'pipeline:run-148:figure',
    request_digest: 'a'.repeat(64),
    provenance: {
      agentId: 'pipeline',
      tool: { name: 'pipeline' },
      model: { provider: 'sheetbase', name: 'pipeline' },
      invocationId: 'run-148',
    },
    proposed_by_user_id: 'user-1',
    proposed_by_credential_id: null,
    approved_by_user_id: null,
    approved_at: null,
    rejected_by_user_id: null,
    rejected_at: null,
    rejection_reason: null,
    executed_by_user_id: null,
    executed_by_credential_id: null,
    executed_at: null,
    result: null,
    error_code: null,
    error_message: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  fetchProposal.mockResolvedValue(null)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const block = (payload: Record<string, unknown>) => ({
  payload,
  payloadSchemaVersion: 1,
})

describe('PipelineOutputBlockPreview', () => {
  it('renders the run output', () => {
    renderWithQuery(
      <PipelineOutputBlockPreview
        payload={{
          runId: RUN_ID,
          datasetVersionId: '0198d970-e266-4000-8000-0000000000c1',
          label: 'scaled measurements',
        }}
      />,
    )
    expect(screen.getByText('scaled measurements')).toBeTruthy()
    expect(screen.getByText(/run 0198d970/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Inspect run' })).toBeTruthy()
  })

  it('states that no proposal is linked rather than showing inert controls', async () => {
    renderWithQuery(<PipelineOutputBlockPreview payload={{ runId: RUN_ID }} />)
    expect(await screen.findByText(PROPOSAL_ABSENT_MESSAGE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull()
  })

  it('renders a linked proposal read-only: Compare, status and a route to decide', async () => {
    fetchProposal.mockResolvedValue(makeProposal())
    renderWithQuery(
      <PipelineOutputBlockPreview
        payload={{ runId: RUN_ID, proposalId: PROPOSAL_ID }}
      />,
    )

    expect(
      await screen.findByText(/A new Figure 1 from DS-0311 snapshot S-15/),
    ).toBeTruthy()
    expect(
      screen.getByText(/Proposed update from pipeline run 0198d970/),
    ).toBeTruthy()
    expect(screen.getByText('Awaiting a decision')).toBeTruthy()
    // A read-only rendering never posts a decision.
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Compare' })).toBeTruthy()
    expect(
      screen.getByRole('link', {
        name: 'Decide this proposal in the pipeline run',
      }),
    ).toBeTruthy()
  })

  it('says a linked proposal could not be read instead of faking one', async () => {
    fetchProposal.mockRejectedValue(new Error('not found'))
    renderWithQuery(
      <PipelineOutputBlockPreview
        payload={{ runId: RUN_ID, proposalId: PROPOSAL_ID }}
      />,
    )
    expect(await screen.findByText(/could not be read/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })
})

describe('PipelineOutputBlockEditor proposal actions', () => {
  const save = vi.fn(async () => ({ ok: true }))

  it('accepts a pending proposal through decide_agent_operation, then applies it', async () => {
    const user = userEvent.setup()
    const approved = makeProposal({
      status: 'approved',
      revision: 2,
      approved_by_user_id: 'user-1',
      approved_at: '2026-10-01T10:05:00Z',
    })
    fetchProposal
      .mockResolvedValueOnce(makeProposal())
      .mockResolvedValueOnce(approved)
      .mockResolvedValue(makeProposal({ status: 'succeeded', revision: 3 }))
    decide.mockResolvedValue(approved)
    execute.mockResolvedValue(
      makeProposal({ status: 'succeeded', revision: 3 }),
    )

    renderWithQuery(
      <PipelineOutputBlockEditor
        block={block({ runId: RUN_ID, proposalId: PROPOSAL_ID })}
        save={save}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Accept' }))
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(expect.anything(), {
        proposalId: PROPOSAL_ID,
        expectedRevision: 1,
        decision: 'approve',
        reason: null,
      }),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Apply change' }),
    )
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(expect.anything(), {
        proposalId: PROPOSAL_ID,
        expectedRevision: 2,
      }),
    )
    expect(await screen.findByText('Applied')).toBeTruthy()
  })

  it('rejects with the reason the RPC records', async () => {
    const user = userEvent.setup()
    const rejected = makeProposal({
      status: 'rejected',
      revision: 2,
      rejection_reason: 'Plate 4 is not in scope',
      rejected_by_user_id: 'user-1',
      rejected_at: '2026-10-01T10:05:00Z',
    })
    fetchProposal
      .mockResolvedValueOnce(makeProposal())
      .mockResolvedValue(rejected)
    decide.mockResolvedValue(rejected)

    renderWithQuery(
      <PipelineOutputBlockEditor
        block={block({ runId: RUN_ID, proposalId: PROPOSAL_ID })}
        save={save}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    await user.type(
      screen.getByLabelText('Reason for rejection'),
      'Plate 4 is not in scope',
    )
    await user.click(screen.getByRole('button', { name: 'Reject proposal' }))

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(expect.anything(), {
        proposalId: PROPOSAL_ID,
        expectedRevision: 1,
        decision: 'reject',
        reason: 'Plate 4 is not in scope',
      }),
    )
    expect(await screen.findByText('Rejected')).toBeTruthy()
  })

  it('shows a decided proposal as its state, with no decision controls', async () => {
    fetchProposal.mockResolvedValue(
      makeProposal({
        status: 'succeeded',
        revision: 2,
        executed_by_user_id: 'user-1',
        executed_at: '2026-10-01T10:06:00Z',
      }),
    )
    renderWithQuery(
      <PipelineOutputBlockEditor
        block={block({ runId: RUN_ID, proposalId: PROPOSAL_ID })}
        save={save}
      />,
    )

    expect(await screen.findByText('Applied')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply change' })).toBeNull()
  })

  it('offers no decision when the caller cannot decide', async () => {
    fetchProposal.mockResolvedValue(makeProposal())
    renderWithQuery(
      <PipelineOutputBlockEditor
        block={block({ runId: RUN_ID, proposalId: PROPOSAL_ID })}
        save={save}
        readOnly
      />,
    )

    expect(await screen.findByText('Awaiting a decision')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Compare' })).toBeTruthy()
  })

  it('states the absence of a proposal instead of inert controls', async () => {
    renderWithQuery(
      <PipelineOutputBlockEditor
        block={block({ runId: RUN_ID })}
        save={save}
      />,
    )
    expect(await screen.findByText(PROPOSAL_ABSENT_MESSAGE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
  })
})
