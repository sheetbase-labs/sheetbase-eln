import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { ProposalWorkbench } from '#/components/agent-operations/proposal-workbench'
import { WorkflowWorkbench } from '#/components/agent-operations/workflow-workbench'
import { useShell } from '#/components/app-shell'
import {
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/ui'
import {
  agentOperationQueryKeys,
  decideAgentOperation,
  executeAgentOperation,
  listAgentOperationEvents,
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
import { hasCapability } from '#/lib/capability'
import { createDataClient } from '#/lib/data-client'

export const Route = createFileRoute('/agent-operations')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: AgentOperationsRoute,
})

const dataClient = createDataClient()

function AgentOperationsRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'workflows' | 'proposals'>('workflows')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  )

  const proposalsQuery = useQuery({
    queryKey: agentOperationQueryKeys.proposals,
    queryFn: () => listAgentOperationProposals(dataClient),
    enabled: Boolean(context.workspace?.id),
  })
  const proposals = proposalsQuery.data ?? []
  const effectiveSelectedId = selectedId ?? proposals.at(0)?.id ?? null
  const selected = useMemo(
    () =>
      proposals.find((proposal) => proposal.id === effectiveSelectedId) ?? null,
    [effectiveSelectedId, proposals],
  )
  const workflowsQuery = useQuery({
    queryKey: agentWorkflowQueryKeys.workflows,
    queryFn: () => listAgentWorkflows(dataClient),
    enabled: Boolean(context.workspace?.id),
  })
  const workflows = workflowsQuery.data ?? []
  const effectiveWorkflowId = selectedWorkflowId ?? workflows.at(0)?.id ?? null
  const workflowStepsQuery = useQuery({
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

  const eventsQuery = useQuery({
    queryKey: agentOperationQueryKeys.events(effectiveSelectedId ?? ''),
    queryFn: () =>
      listAgentOperationEvents(dataClient, effectiveSelectedId ?? ''),
    enabled: Boolean(effectiveSelectedId),
  })

  useEffect(() => {
    if (
      selectedId &&
      proposals.length > 0 &&
      !proposals.some((proposal) => proposal.id === selectedId)
    ) {
      setSelectedId(proposals[0].id)
    }
  }, [proposals, selectedId])
  useEffect(() => {
    if (
      selectedWorkflowId &&
      workflows.length > 0 &&
      !workflows.some((workflow) => workflow.id === selectedWorkflowId)
    ) {
      setSelectedWorkflowId(workflows[0].id)
    }
  }, [selectedWorkflowId, workflows])

  const refresh = async (proposalId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: agentOperationQueryKeys.proposals,
      }),
      queryClient.invalidateQueries({
        queryKey: agentOperationQueryKeys.events(proposalId),
      }),
    ])
  }

  const approveMutation = useMutation({
    mutationFn: (proposal: AgentOperationProposal) =>
      decideAgentOperation(dataClient, {
        proposalId: proposal.id,
        expectedRevision: proposalRevision(proposal),
        decision: 'approve',
      }),
    onSuccess: (proposal) => refresh(proposal.id),
  })
  const rejectMutation = useMutation({
    mutationFn: ({
      proposal,
      reason,
    }: {
      proposal: AgentOperationProposal
      reason: string
    }) =>
      decideAgentOperation(dataClient, {
        proposalId: proposal.id,
        expectedRevision: proposalRevision(proposal),
        decision: 'reject',
        reason,
      }),
    onSuccess: (proposal) => refresh(proposal.id),
  })
  const executeMutation = useMutation({
    mutationFn: (proposal: AgentOperationProposal) =>
      executeAgentOperation(dataClient, {
        proposalId: proposal.id,
        expectedRevision: proposalRevision(proposal),
      }),
    onSuccess: (proposal) => refresh(proposal.id),
  })
  const refreshWorkflow = async (workflow: AgentWorkflow) => {
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
  const advanceWorkflowMutation = useMutation({
    mutationFn: (workflow: AgentWorkflow) =>
      advanceAgentWorkflow(dataClient, workflow),
    onSuccess: refreshWorkflow,
  })
  const resumeWorkflowMutation = useMutation({
    mutationFn: (workflow: AgentWorkflow) =>
      resumeAgentWorkflow(dataClient, workflow),
    onSuccess: refreshWorkflow,
  })
  const cancelWorkflowMutation = useMutation({
    mutationFn: ({
      workflow,
      reason,
    }: {
      workflow: AgentWorkflow
      reason: string
    }) => cancelAgentWorkflow(dataClient, { workflow, reason }),
    onSuccess: refreshWorkflow,
  })

  const canApprove = selected
    ? selected.operation_kind === 'dataset_rows.commit'
      ? hasCapability(context.workspace?.role, 'record.create')
      : selected.operation_kind.startsWith('pipeline_definition.')
        ? hasCapability(context.workspace?.role, 'pipelines.manage')
        : hasCapability(context.workspace?.role, 'schema.edit')
    : false
  const error =
    proposalsQuery.error ??
    eventsQuery.error ??
    approveMutation.error ??
    rejectMutation.error ??
    executeMutation.error ??
    workflowsQuery.error ??
    workflowStepsQuery.error ??
    workflowEventsQuery.error ??
    advanceWorkflowMutation.error ??
    resumeWorkflowMutation.error ??
    cancelWorkflowMutation.error
  const pendingAction = approveMutation.isPending
    ? 'approve'
    : rejectMutation.isPending
      ? 'reject'
      : executeMutation.isPending
        ? 'execute'
        : null
  const pendingWorkflowAction = advanceWorkflowMutation.isPending
    ? 'advance'
    : resumeWorkflowMutation.isPending
      ? 'resume'
      : cancelWorkflowMutation.isPending
        ? 'cancel'
        : null

  useShell({
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: {
        name: context.user.name,
        email: context.user.email,
        role: context.workspace?.role,
      },
    },
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Agent operations' }],
    fullBleed: true,
  })

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="px-4 pt-4">
        <PageHeader
          eyebrow={context.workspace?.name ?? undefined}
          title="Agent operations"
          description="Inspect pinned multi-step plans and approve each canonical operation with a human session."
          className="border-0 pb-4"
        />
      </div>
      {error instanceof Error && (
        <p role="alert" className="text-destructive px-4 pb-3 text-sm">
          {error.message}
        </p>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) =>
          setTab(value === 'proposals' ? 'proposals' : 'workflows')
        }
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-4 mb-3 w-fit">
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="proposals">Operation proposals</TabsTrigger>
        </TabsList>
        <TabsContent
          value="workflows"
          className="mt-0 flex min-h-0 flex-1 flex-col"
        >
          {workflowsQuery.isLoading ? (
            <Skeleton className="m-4 h-72" />
          ) : (
            <WorkflowWorkbench
              workflows={workflows}
              steps={workflowStepsQuery.data ?? []}
              events={workflowEventsQuery.data ?? []}
              selectedId={effectiveWorkflowId}
              onSelect={setSelectedWorkflowId}
              onAdvance={(workflow) => advanceWorkflowMutation.mutate(workflow)}
              onResume={(workflow) => resumeWorkflowMutation.mutate(workflow)}
              onCancel={(workflow, reason) =>
                cancelWorkflowMutation.mutate({ workflow, reason })
              }
              onInspectProposal={(proposalId) => {
                setSelectedId(proposalId)
                setTab('proposals')
              }}
              pendingAction={pendingWorkflowAction}
            />
          )}
        </TabsContent>
        <TabsContent
          value="proposals"
          className="mt-0 flex min-h-0 flex-1 flex-col"
        >
          {proposalsQuery.isLoading ? (
            <Skeleton className="m-4 h-72" />
          ) : (
            <ProposalWorkbench
              proposals={proposals}
              events={eventsQuery.data ?? []}
              selectedId={effectiveSelectedId}
              onSelect={setSelectedId}
              onApprove={(proposal) => approveMutation.mutate(proposal)}
              onReject={(proposal, reason) =>
                rejectMutation.mutate({ proposal, reason })
              }
              onExecute={(proposal) => executeMutation.mutate(proposal)}
              canApprove={canApprove}
              pendingAction={pendingAction}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
