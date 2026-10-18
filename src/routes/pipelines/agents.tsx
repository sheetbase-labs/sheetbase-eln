import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PageHeader } from '#/components/v3/ui/layout'
import { Tabs } from '#/components/v3/ui/tabs'
import {
  AgentPoliciesPanel,
  AgentProposalsPanel,
  AgentWorkflowsPanel,
} from '#/components/v3/pipelines/agents/agent-surface'
import {
  agentOperationQueryKeys,
  createAgentOperationPolicy,
  decideAgentOperation,
  disableAgentOperationPolicy,
  executeAgentOperation,
  listAgentOperationEvents,
  listAgentOperationPolicies,
  listAgentOperationProposals,
  proposalRevision,
} from '#/lib/agent-operations'
import type { AgentOperationProposal } from '#/lib/agent-operations'
import {
  advanceAgentWorkflow,
  agentWorkflowQueryKeys,
  cancelAgentWorkflow,
  listAgentWorkflowEvents,
  listAgentWorkflows,
  listAgentWorkflowSteps,
  resumeAgentWorkflow,
} from '#/lib/agent-workflows'
import type { AgentWorkflow } from '#/lib/agent-workflows'
import { listApiCredentialsFn } from '#/lib/api-credential-admin'
import { hasCapability } from '#/lib/capability'
import { createDataClient } from '#/lib/data-client'

/**
 * UI port (roadmap-4/ui-app3): the agent surface, folded from the retired
 * `/agent-operations` route into `/pipelines/agents` (DEC-03, PIPE-01). Reads
 * real proposals, workflows and policies through the existing RPCs.
 */
export const Route = createFileRoute('/pipelines/agents')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    view?: 'workflows' | 'proposals' | 'policies'
    proposal?: string
    workflow?: string
  } => ({
    view:
      search.view === 'proposals' || search.view === 'policies'
        ? search.view
        : search.view === 'workflows'
          ? 'workflows'
          : undefined,
    proposal: typeof search.proposal === 'string' ? search.proposal : undefined,
    workflow: typeof search.workflow === 'string' ? search.workflow : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: AgentsRoute,
})

const dataClient = createDataClient()

function AgentsRoute() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const view = search.view ?? 'proposals'
  const [proposalId, setProposalId] = useState<string | null>(
    search.proposal ?? null,
  )
  const [workflowId, setWorkflowId] = useState<string | null>(
    search.workflow ?? null,
  )
  const workspaceId = context.workspace?.id ?? ''

  const proposalsQuery = useQuery({
    queryKey: agentOperationQueryKeys.proposals,
    queryFn: () => listAgentOperationProposals(dataClient),
    enabled: Boolean(workspaceId),
  })
  const policiesQuery = useQuery({
    queryKey: agentOperationQueryKeys.policies,
    queryFn: () => listAgentOperationPolicies(dataClient),
    enabled: Boolean(workspaceId),
  })
  const credentialsQuery = useQuery({
    queryKey: ['agent-operations', 'credentials', workspaceId],
    queryFn: () => listApiCredentialsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
  })
  const proposals = proposalsQuery.data ?? []
  const effectiveProposalId = proposalId ?? proposals.at(0)?.id ?? null
  const selectedProposal =
    proposals.find((p) => p.id === effectiveProposalId) ?? null

  const workflowsQuery = useQuery({
    queryKey: agentWorkflowQueryKeys.workflows,
    queryFn: () => listAgentWorkflows(dataClient),
    enabled: Boolean(workspaceId),
  })
  const workflows = workflowsQuery.data ?? []
  const effectiveWorkflowId = workflowId ?? workflows.at(0)?.id ?? null
  const stepsQuery = useQuery({
    queryKey: agentWorkflowQueryKeys.steps(effectiveWorkflowId ?? ''),
    queryFn: () =>
      listAgentWorkflowSteps(dataClient, effectiveWorkflowId ?? ''),
    enabled: Boolean(effectiveWorkflowId),
  })
  const workflowEventsQuery = useQuery({
    queryKey: agentWorkflowQueryKeys.events(effectiveWorkflowId ?? ''),
    queryFn: () =>
      listAgentWorkflowEvents(dataClient, effectiveWorkflowId ?? ''),
    enabled: Boolean(effectiveWorkflowId),
  })
  const proposalEventsQuery = useQuery({
    queryKey: agentOperationQueryKeys.events(effectiveProposalId ?? ''),
    queryFn: () =>
      listAgentOperationEvents(dataClient, effectiveProposalId ?? ''),
    enabled: Boolean(effectiveProposalId),
  })

  const refreshProposals = async (id: string) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: agentOperationQueryKeys.proposals,
      }),
      queryClient.invalidateQueries({
        queryKey: agentOperationQueryKeys.events(id),
      }),
      queryClient.invalidateQueries({
        queryKey: agentOperationQueryKeys.policies,
      }),
    ])
  }
  const refreshPolicies = () =>
    queryClient.invalidateQueries({
      queryKey: agentOperationQueryKeys.policies,
    })
  const refreshWorkflows = async (workflow: AgentWorkflow) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: agentWorkflowQueryKeys.workflows,
      }),
      queryClient.invalidateQueries({
        queryKey: agentWorkflowQueryKeys.steps(workflow.id),
      }),
      queryClient.invalidateQueries({
        queryKey: agentWorkflowQueryKeys.events(workflow.id),
      }),
      queryClient.invalidateQueries({
        queryKey: agentOperationQueryKeys.proposals,
      }),
    ])
  }

  const approve = useMutation({
    mutationFn: (p: AgentOperationProposal) =>
      decideAgentOperation(dataClient, {
        proposalId: p.id,
        expectedRevision: proposalRevision(p),
        decision: 'approve',
      }),
    onSuccess: (p) => refreshProposals(p.id),
  })
  const reject = useMutation({
    mutationFn: ({
      p,
      reason,
    }: {
      p: AgentOperationProposal
      reason: string
    }) =>
      decideAgentOperation(dataClient, {
        proposalId: p.id,
        expectedRevision: proposalRevision(p),
        decision: 'reject',
        reason,
      }),
    onSuccess: (p) => refreshProposals(p.id),
  })
  const execute = useMutation({
    mutationFn: (p: AgentOperationProposal) =>
      executeAgentOperation(dataClient, {
        proposalId: p.id,
        expectedRevision: proposalRevision(p),
      }),
    onSuccess: (p) => refreshProposals(p.id),
  })
  const createPolicy = useMutation({
    mutationFn: (input: {
      name: string
      credentialId: string
      targetType: Parameters<typeof createAgentOperationPolicy>[1]['targetType']
      targetId: string | null
      maxAffectedRows: number
      reason: string
      meaning: string
    }) =>
      createAgentOperationPolicy(dataClient, {
        workspaceId,
        name: input.name,
        operationKind: 'dataset_rows.commit',
        credentialId: input.credentialId,
        targetType: input.targetType,
        targetId: input.targetId,
        maxAffectedRows: input.maxAffectedRows,
        reason: input.reason,
        meaning: input.meaning,
      }),
    onSuccess: refreshPolicies,
  })
  const disablePolicy = useMutation({
    mutationFn: (policyId: string) =>
      disableAgentOperationPolicy(dataClient, { workspaceId, policyId }),
    onSuccess: refreshPolicies,
  })
  const advance = useMutation({
    mutationFn: (w: AgentWorkflow) => advanceAgentWorkflow(dataClient, w),
    onSuccess: refreshWorkflows,
  })
  const resume = useMutation({
    mutationFn: (w: AgentWorkflow) => resumeAgentWorkflow(dataClient, w),
    onSuccess: refreshWorkflows,
  })
  const cancel = useMutation({
    mutationFn: ({ w, reason }: { w: AgentWorkflow; reason: string }) =>
      cancelAgentWorkflow(dataClient, { workflow: w, reason }),
    onSuccess: refreshWorkflows,
  })

  const canApprove = selectedProposal
    ? selectedProposal.operation_kind === 'dataset_rows.commit'
      ? hasCapability(context.workspace?.role, 'record.create')
      : selectedProposal.operation_kind.startsWith('pipeline_definition.')
        ? hasCapability(context.workspace?.role, 'pipelines.manage')
        : hasCapability(context.workspace?.role, 'schema.edit')
    : false
  const canManagePolicies =
    context.workspace?.role === 'owner' || context.workspace?.role === 'steward'

  const pendingAction = approve.isPending
    ? 'approve'
    : reject.isPending
      ? 'reject'
      : execute.isPending
        ? 'execute'
        : null
  const pendingWorkflow = advance.isPending
    ? 'advance'
    : resume.isPending
      ? 'resume'
      : cancel.isPending
        ? 'cancel'
        : null

  const error =
    proposalsQuery.error ??
    policiesQuery.error ??
    credentialsQuery.error ??
    workflowsQuery.error ??
    stepsQuery.error ??
    workflowEventsQuery.error ??
    proposalEventsQuery.error ??
    approve.error ??
    reject.error ??
    execute.error ??
    createPolicy.error ??
    disablePolicy.error ??
    advance.error ??
    resume.error ??
    cancel.error

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[{ label: 'Agents' }]}
        title="Agents"
        meta={
          <>
            <span>{workflows.length} workflows</span>
            <span>{proposals.length} proposals</span>
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label="Agent sections"
            value={view}
            items={[
              {
                key: 'proposals',
                label: 'Proposals',
                count: proposals.length,
                link: {
                  to: '/pipelines/agents',
                  search: { view: 'proposals' },
                },
              },
              {
                key: 'workflows',
                label: 'Workflows',
                count: workflows.length,
                link: {
                  to: '/pipelines/agents',
                  search: { view: 'workflows' },
                },
              },
              {
                key: 'policies',
                label: 'Policies',
                count: policiesQuery.data?.length,
                link: { to: '/pipelines/agents', search: { view: 'policies' } },
              },
            ]}
          />
        }
      />
      {error instanceof Error ? (
        <p
          role="alert"
          className="px-4 pb-3 text-label text-danger-text md:px-6"
        >
          {error.message}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {view === 'proposals' ? (
          <AgentProposalsPanel
            proposals={proposals}
            events={proposalEventsQuery.data ?? []}
            selectedId={effectiveProposalId}
            onSelect={(id) => {
              setProposalId(id)
              void navigate({
                to: '/pipelines/agents',
                search: {
                  view: search.view,
                  proposal: id,
                  workflow: search.workflow,
                },
                replace: true,
              })
            }}
            onApprove={(p) => approve.mutate(p)}
            onReject={(p, reason) => reject.mutate({ p, reason })}
            onExecute={(p) => execute.mutate(p)}
            canApprove={canApprove}
            pendingAction={pendingAction}
          />
        ) : view === 'policies' ? (
          <AgentPoliciesPanel
            policies={policiesQuery.data ?? []}
            credentials={(credentialsQuery.data ?? []).map((c) => ({
              id: c.id,
              name: c.name,
              displayPrefix: c.displayPrefix,
            }))}
            canManage={canManagePolicies}
            onCreate={(input) => createPolicy.mutate(input)}
            onDisable={(policy) => disablePolicy.mutate(policy.id)}
          />
        ) : (
          <AgentWorkflowsPanel
            workflows={workflows}
            steps={stepsQuery.data ?? []}
            events={workflowEventsQuery.data ?? []}
            proposals={proposals}
            selectedId={effectiveWorkflowId}
            onSelect={(id) => {
              setWorkflowId(id)
              void navigate({
                to: '/pipelines/agents',
                search: {
                  view: search.view,
                  proposal: search.proposal,
                  workflow: id,
                },
                replace: true,
              })
            }}
            onAdvance={(w) => advance.mutate(w)}
            onResume={(w) => resume.mutate(w)}
            onCancel={(w, reason) => cancel.mutate({ w, reason })}
            onInspectProposal={(id) => {
              setProposalId(id)
              void navigate({
                to: '/pipelines/agents',
                search: {
                  view: 'proposals',
                  proposal: id,
                  workflow: search.workflow,
                },
              })
            }}
            pendingAction={pendingWorkflow}
          />
        )}
      </div>
    </div>
  )
}
