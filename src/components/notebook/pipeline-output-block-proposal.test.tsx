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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentOperationProposal } from '#/lib/agent-operations'
import type { NotebookBlock } from '#/lib/notebook-data'
import { dropSharedReads } from '#/lib/data-client'
import { PipelineOutputBlockEditor } from './pipeline-output-block-editor'
import { PipelineOutputBlockPreview } from './pipeline-output-block-preview'

const PROPOSAL_ABSENT_MESSAGE =
  'No pipeline proposal is linked to this block. Pipeline changes apply directly when a run succeeds, unless the pipeline is set to propose them first.'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

let proposal: AgentOperationProposal | null = null
let decisionResult: AgentOperationProposal | null = null
let executionResult: AgentOperationProposal | null = null
let unavailable = false

let readOutputs: (runId: string) => Promise<Response> = async () =>
  Response.json([])

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
    display_id: null,
    agent_definition_id: null,
    agent_run_id: null,
    approver_user_id: null,
    signature_required: false,
    approval_meaning: null,
    approval_signed_at: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  dropSharedReads()
  proposal = null
  decisionResult = null
  executionResult = null
  unavailable = false
  readOutputs = async () => Response.json([])
  transport.mockReset()
  transport.mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    if (url.pathname === '/api/db/agent_operation_proposals') {
      if (unavailable) throw new Error('not found')

      return Response.json(proposal ? [proposal] : [])
    }

    if (url.pathname === '/api/db/rpc/decide_agent_operation') {
      proposal = decisionResult
      dropSharedReads()

      return Response.json(proposal)
    }

    if (url.pathname === '/api/db/rpc/execute_agent_operation') {
      proposal = executionResult
      dropSharedReads()

      return Response.json(proposal)
    }

    if (url.pathname === '/api/db/pipeline_runs') return Response.json([])

    if (url.pathname === '/api/db/pipeline_run_outputs')
      return readOutputs(
        (url.searchParams.get('run_id') ?? '').slice('eq.'.length),
      )
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
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

const block = (payload: NotebookBlock['payload']) => ({
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
    proposal = makeProposal()
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
    unavailable = true
    renderWithQuery(
      <PipelineOutputBlockPreview
        payload={{ runId: RUN_ID, proposalId: PROPOSAL_ID }}
      />,
    )
    expect(await screen.findByText(/couldn’t be read/)).toBeTruthy()
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

    proposal = makeProposal()
    decisionResult = approved
    executionResult = makeProposal({ status: 'succeeded', revision: 3 })

    renderWithQuery(
      <PipelineOutputBlockEditor
        block={block({ runId: RUN_ID, proposalId: PROPOSAL_ID })}
        save={save}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Accept' }))
    await waitFor(() =>
      expect(transport).toHaveBeenCalledWith(
        '/api/db/rpc/decide_agent_operation',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            p_proposal_id: PROPOSAL_ID,
            p_expected_revision: 1,
            p_decision: 'approve',
            p_reason: null,
          }),
        }),
      ),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Apply change' }),
    )
    await waitFor(() =>
      expect(transport).toHaveBeenCalledWith(
        '/api/db/rpc/execute_agent_operation',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            p_proposal_id: PROPOSAL_ID,
            p_expected_revision: 2,
          }),
        }),
      ),
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

    proposal = makeProposal()
    decisionResult = rejected

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
      expect(transport).toHaveBeenCalledWith(
        '/api/db/rpc/decide_agent_operation',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            p_proposal_id: PROPOSAL_ID,
            p_expected_revision: 1,
            p_decision: 'reject',
            p_reason: 'Plate 4 is not in scope',
          }),
        }),
      ),
    )
    expect(await screen.findByText('Rejected')).toBeTruthy()
  })

  it('shows a decided proposal as its state, with no decision controls', async () => {
    proposal = makeProposal({
      status: 'succeeded',
      revision: 2,
      executed_by_user_id: 'user-1',
      executed_at: '2026-10-01T10:06:00Z',
    })
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
    proposal = makeProposal()
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

  it('persists a pasted run with its actual dataset version and retains the proposal link', async () => {
    const user = userEvent.setup()
    const nextRun = '0198d970-e266-4000-8000-0000000000b2'
    readOutputs = async (runId) =>
      Response.json(
        runId === nextRun
          ? [
              {
                id: 'output-2',
                workspace_id: 'workspace-1',
                run_id: nextRun,
                dataset_id: 'dataset-2',
                dataset_version_id: 'version-2',
                label: 'Pinned plate',
                created_at: '2026-11-10T10:00:00Z',
              },
            ]
          : [],
      )
    renderWithQuery(
      <PipelineOutputBlockEditor
        block={block({ runId: RUN_ID, proposalId: PROPOSAL_ID })}
        save={save}
      />,
    )
    const input = screen.getByRole('textbox')
    await user.clear(input)
    expect(screen.getByRole('textbox')).toBe(input)
    await user.paste(nextRun)
    await user.tab()
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        proposalId: PROPOSAL_ID,
        runId: nextRun,
        datasetId: 'dataset-2',
        datasetVersionId: 'version-2',
        label: 'Pinned plate',
      }),
    )
  })

  it('refuses late output lookups after a newer selection and after clearing', async () => {
    const pending = new Map<string, (response: Response) => void>()
    readOutputs = async (runId) => {
      if (runId === RUN_ID) return Response.json([])

      return new Promise<Response>((resolve) => pending.set(runId, resolve))
    }

    renderWithQuery(
      <PipelineOutputBlockEditor
        block={block({ runId: RUN_ID, proposalId: PROPOSAL_ID })}
        save={save}
      />,
    )
    const input = screen.getByRole('textbox')
    const earlier = '0198d970-e266-4000-8000-0000000000b2'
    const newer = '0198d970-e266-4000-8000-0000000000b3'
    fireEvent.change(input, { target: { value: earlier } })
    fireEvent.blur(input)
    await waitFor(() => expect(pending.has(earlier)).toBe(true))
    fireEvent.change(input, { target: { value: newer } })
    fireEvent.blur(input)
    await waitFor(() => expect(pending.has(newer)).toBe(true))
    const finishNew = pending.get(newer)
    const finishOld = pending.get(earlier)

    if (!finishNew || !finishOld)
      throw new Error('Expected both output requests')
    await act(async () => finishNew(Response.json([])))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ runId: newer }),
      ),
    )
    const count = save.mock.calls.length
    await act(async () => finishOld(Response.json([])))
    expect(save).toHaveBeenCalledTimes(count)

    const abandoned = '0198d970-e266-4000-8000-0000000000b4'
    fireEvent.change(input, { target: { value: abandoned } })
    fireEvent.blur(input)
    await waitFor(() => expect(pending.has(abandoned)).toBe(true))
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear reference' }),
    )
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({ proposalId: PROPOSAL_ID }),
    )
    expect(screen.queryByRole('textbox')).toBeNull()
    const clearedCount = save.mock.calls.length
    const finishAbandoned = pending.get(abandoned)

    if (!finishAbandoned) throw new Error('Expected abandoned output request')
    await act(async () => finishAbandoned(Response.json([])))
    expect(save).toHaveBeenCalledTimes(clearedCount)
  })
})
