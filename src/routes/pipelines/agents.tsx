import { useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { buttonVariants } from '#/components/v3/ui/button'
import { PageHeader } from '#/components/v3/ui/layout'
import { Tabs } from '#/components/v3/ui/tabs'
import {
  AgentPoliciesPanel,
  AgentWorkflowsPanel,
} from '#/components/v3/pipelines/agents/agent-surface'
import { AgentPoliciesBoard } from '#/components/v3/pipelines/agents/policies-board'
import {
  AgentProposalsBoard,
  proposalBoardGroups,
} from '#/components/v3/pipelines/agents/proposals-board'
import { AgentWorkflowsBoard } from '#/components/v3/pipelines/agents/workflows-board'
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
  agentRegistryQueryKeys,
  changeAgentPolicy,
  listAgentDefinitions,
  listAgentPolicyRevisions,
  listAgentProjects,
  listAgentRuns,
  listWorkspaceMembers,
  setAgentDefinitionEnabled,
  signAgentOperation,
} from '#/lib/agent-registry'
import type { AgentDefinition } from '#/lib/agent-registry'
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
import { now } from '#/lib/clock'
import { createDataClient } from '#/lib/data-client'
import { signInRedirect } from '#/lib/sign-in-redirect'

/**
 * The Agents page: the proposals people decide, the workflows that make them,
 * and the policy that says what each may do. The page reads the registry
 * (workflows, runs, policy revisions) and the real proposal, execution-policy
 * and plan-run RPCs, and keeps the human approve, reject and execute controls.
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
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: AgentsRoute,
})

const dataClient = createDataClient()

/** Whether this person's role may decide a proposal of this kind. */
function mayDecide(
  proposal: AgentOperationProposal,
  role: string | undefined,
): boolean {
  const kind = proposal.operation_kind
  if (kind.startsWith('pipeline_definition.'))
    return hasCapability(role, 'pipelines.manage')
  if (
    kind.startsWith('notebook_block.') ||
    kind.startsWith('record.') ||
    kind.startsWith('sheet_instance.') ||
    kind.startsWith('template.') ||
    kind.startsWith('model_field.') ||
    kind === 'dataset_rows.commit'
  )
    return hasCapability(role, 'record.create')
  return hasCapability(role, 'schema.edit')
}

function AgentsRoute() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const view = search.view ?? 'proposals'
  const [proposalId, setProposalId] = useState<string | null>(
    search.proposal ?? null,
  )
  const [planId, setPlanId] = useState<string | null>(null)
  const workspaceId = context.workspace?.id ?? ''
  const role = context.workspace?.role
  const userId = context.user.id
  const clock = now()

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
  const definitionsQuery = useQuery({
    queryKey: agentRegistryQueryKeys.definitions,
    queryFn: () => listAgentDefinitions(dataClient),
    enabled: Boolean(workspaceId),
  })
  const runsQuery = useQuery({
    queryKey: agentRegistryQueryKeys.runs,
    queryFn: () => listAgentRuns(dataClient),
    enabled: Boolean(workspaceId),
  })
  const revisionsQuery = useQuery({
    queryKey: agentRegistryQueryKeys.revisions,
    queryFn: () => listAgentPolicyRevisions(dataClient),
    enabled: Boolean(workspaceId),
  })
  const membersQuery = useQuery({
    queryKey: agentRegistryQueryKeys.members,
    queryFn: () => listWorkspaceMembers(dataClient),
    enabled: Boolean(workspaceId),
  })
  const projectsQuery = useQuery({
    queryKey: agentRegistryQueryKeys.projects,
    queryFn: () => listAgentProjects(dataClient),
    enabled: Boolean(workspaceId),
  })
  const proposals = proposalsQuery.data ?? []
  const definitions = definitionsQuery.data ?? []
  const runs = runsQuery.data ?? []
  const members = membersQuery.data ?? []
  const nameOf = (id: string | null) =>
    id ? (members.find((m) => m.user_id === id)?.name ?? null) : null
  const projectName = (id: string) =>
    projectsQuery.data?.find((p) => p.id === id)?.title ??
    t('data.pipelinesAgents.aProject')

  const canApproveAny = hasCapability(role, 'record.create')
  const me = { userId, canApprove: canApproveAny }
  const canManagePolicies = role === 'owner' || role === 'steward'

  const visibleProposals = proposalBoardGroups(proposals, me, clock).flatMap(
    (group) => group.items,
  )
  const effectiveProposalId =
    visibleProposals.find((p) => p.id === proposalId)?.id ??
    visibleProposals.at(0)?.id ??
    null
  const needsYou = proposalBoardGroups(proposals, me, clock).find(
    (group) => group.stage === 'needs',
  )?.items.length

  const selectedDefinition =
    definitions.find((d) => d.display_id === search.workflow) ??
    definitions.at(0) ??
    null

  // The API-driven plan runs the registry replaced as the main view stay
  // reachable under Workflows.
  const plansQuery = useQuery({
    queryKey: agentWorkflowQueryKeys.workflows,
    queryFn: () => listAgentWorkflows(dataClient),
    enabled: Boolean(workspaceId),
  })
  const plans = plansQuery.data ?? []
  const effectivePlanId = planId ?? plans.at(0)?.id ?? null
  const stepsQuery = useQuery({
    queryKey: agentWorkflowQueryKeys.steps(effectivePlanId ?? ''),
    queryFn: () => listAgentWorkflowSteps(dataClient, effectivePlanId ?? ''),
    enabled: Boolean(effectivePlanId),
  })
  const planEventsQuery = useQuery({
    queryKey: agentWorkflowQueryKeys.events(effectivePlanId ?? ''),
    queryFn: () => listAgentWorkflowEvents(dataClient, effectivePlanId ?? ''),
    enabled: Boolean(effectivePlanId),
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
      queryClient.invalidateQueries({ queryKey: agentRegistryQueryKeys.runs }),
    ])
  }
  const refreshPolicies = () =>
    queryClient.invalidateQueries({
      queryKey: agentOperationQueryKeys.policies,
    })
  const refreshPlans = async (workflow: AgentWorkflow) => {
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

  /** Sign if the policy asks, approve, then run what was approved. */
  const approve = useMutation({
    mutationFn: async ({
      p,
      meaning,
    }: {
      p: AgentOperationProposal
      meaning: string | null
    }) => {
      let current = p
      if (p.signature_required && !p.approval_meaning) {
        if (!meaning)
          throw new Error(t('data.pipelinesAgents.signApproveProposal'))
        current = await signAgentOperation(dataClient, {
          proposalId: p.id,
          expectedRevision: proposalRevision(p),
          meaning,
        })
      }
      const approved = await decideAgentOperation(dataClient, {
        proposalId: p.id,
        expectedRevision: proposalRevision(current),
        decision: 'approve',
      })
      return executeAgentOperation(dataClient, {
        proposalId: p.id,
        expectedRevision: proposalRevision(approved),
      })
    },
    onSettled: (_result, _error, { p }) => refreshProposals(p.id),
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
    onSettled: (_result, _error, p) => refreshProposals(p.id),
  })
  const toggle = useMutation({
    mutationFn: ({
      definition,
      enabled,
    }: {
      definition: AgentDefinition
      enabled: boolean
    }) =>
      setAgentDefinitionEnabled(dataClient, {
        definitionId: definition.id,
        enabled,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: agentRegistryQueryKeys.definitions,
      }),
  })
  const changePolicy = useMutation({
    mutationFn: (input: Parameters<typeof changeAgentPolicy>[1]) =>
      changeAgentPolicy(dataClient, input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentRegistryQueryKeys.definitions,
        }),
        queryClient.invalidateQueries({
          queryKey: agentRegistryQueryKeys.revisions,
        }),
      ]),
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
    onSuccess: refreshPlans,
  })
  const resume = useMutation({
    mutationFn: (w: AgentWorkflow) => resumeAgentWorkflow(dataClient, w),
    onSuccess: refreshPlans,
  })
  const cancel = useMutation({
    mutationFn: ({ w, reason }: { w: AgentWorkflow; reason: string }) =>
      cancelAgentWorkflow(dataClient, { workflow: w, reason }),
    onSuccess: refreshPlans,
  })

  const pendingAction = approve.isPending
    ? 'approve'
    : reject.isPending
      ? 'reject'
      : execute.isPending
        ? 'execute'
        : null
  const pendingPlan = advance.isPending
    ? 'advance'
    : resume.isPending
      ? 'resume'
      : cancel.isPending
        ? 'cancel'
        : null

  const message = (error: unknown) =>
    error instanceof Error ? error.message : null
  const proposalError =
    message(approve.error) ?? message(reject.error) ?? message(execute.error)
  const loadError =
    proposalsQuery.error ??
    policiesQuery.error ??
    credentialsQuery.error ??
    definitionsQuery.error ??
    runsQuery.error ??
    revisionsQuery.error ??
    plansQuery.error ??
    stepsQuery.error ??
    planEventsQuery.error ??
    proposalEventsQuery.error ??
    createPolicy.error ??
    disablePolicy.error ??
    advance.error ??
    resume.error ??
    cancel.error

  const canToggle = (definition: AgentDefinition) =>
    definition.owner_user_id === userId || canManagePolicies

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        trail={[
          {
            label: t('data.pipelinesAgents.pipelines'),
            link: { to: '/pipelines' },
          },
          { label: t('data.pipelinesAgents.agents') },
        ]}
        title={t('data.pipelinesAgents.agents')}
        actions={
          <Link
            to="/settings/audit"
            className={buttonVariants({ variant: 'quiet' })}
          >
            {t('data.pipelinesAgents.auditLog')}
          </Link>
        }
        meta={
          <span>{t('data.pipelinesAgents.automationsReadDataPropose')}</span>
        }
        tabs={
          <Tabs
            mode="url"
            label={t('data.pipelinesAgents.agentSections')}
            value={view}
            items={[
              {
                key: 'proposals',
                label: t('data.pipelinesAgents.proposals'),
                count: needsYou,
                link: {
                  to: '/pipelines/agents',
                  search: { view: 'proposals' },
                },
              },
              {
                key: 'workflows',
                label: t('data.pipelinesAgents.workflows'),
                count: definitions.length,
                link: {
                  to: '/pipelines/agents',
                  search: { view: 'workflows' },
                },
              },
              {
                key: 'policies',
                label: t('data.pipelinesAgents.policies'),
                link: { to: '/pipelines/agents', search: { view: 'policies' } },
              },
            ]}
          />
        }
      />
      {loadError instanceof Error ? (
        <p
          role="alert"
          className="px-4 py-2 text-label text-danger-text md:px-6"
        >
          {loadError.message}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {view === 'proposals' ? (
          <AgentProposalsBoard
            proposals={proposals}
            definitions={definitions}
            runs={runs}
            events={proposalEventsQuery.data ?? []}
            selectedId={effectiveProposalId}
            onSelect={(id) => {
              setProposalId(id)
              void navigate({
                to: '/pipelines/agents',
                search: { view: search.view, proposal: id },
                replace: true,
              })
            }}
            onApprove={(p, meaning) => approve.mutate({ p, meaning })}
            onReject={(p, reason) => reject.mutate({ p, reason })}
            onExecute={(p) => execute.mutate(p)}
            me={me}
            canApproveProposal={(p) => mayDecide(p, role)}
            nameOf={nameOf}
            now={clock}
            pendingAction={pendingAction}
            error={proposalError}
          />
        ) : view === 'policies' ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <AgentPoliciesBoard
              definitions={definitions}
              revisions={revisionsQuery.data ?? []}
              initialDefinitionId={
                definitions.find((d) => d.display_id === search.workflow)?.id
              }
              canChange={canManagePolicies}
              onChange={({ definition, ...rest }) =>
                changePolicy.mutateAsync({
                  definitionId: definition.id,
                  ...rest,
                })
              }
              nameOf={nameOf}
              projectName={projectName}
              pending={changePolicy.isPending}
              error={message(changePolicy.error)}
            />
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
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <AgentWorkflowsBoard
              definitions={definitions}
              runs={runs}
              proposals={proposals}
              selectedId={selectedDefinition?.id ?? null}
              onSelect={(id) => {
                const definition = definitions.find((d) => d.id === id)
                void navigate({
                  to: '/pipelines/agents',
                  search: {
                    view: 'workflows',
                    workflow: definition?.display_id,
                  },
                  replace: true,
                })
              }}
              onToggle={(definition, enabled) =>
                toggle.mutate({ definition, enabled })
              }
              canToggle={canToggle}
              me={me}
              nameOf={nameOf}
              projectName={projectName}
              now={clock}
              pending={toggle.isPending}
              error={message(toggle.error)}
            />
            {plans.length ? (
              <details className="border-t border-border">
                <summary className="cursor-pointer px-4 py-2 text-label font-medium text-fg-muted md:px-6">
                  {t('data.pipelinesAgents.plansStartedThroughApi', {
                    length: plans.length,
                  })}
                </summary>
                <div className="flex h-[420px] min-h-0">
                  <AgentWorkflowsPanel
                    workflows={plans}
                    steps={stepsQuery.data ?? []}
                    events={planEventsQuery.data ?? []}
                    proposals={proposals}
                    selectedId={effectivePlanId}
                    onSelect={setPlanId}
                    onAdvance={(w) => advance.mutate(w)}
                    onResume={(w) => resume.mutate(w)}
                    onCancel={(w, reason) => cancel.mutate({ w, reason })}
                    onInspectProposal={(id) => {
                      setProposalId(id)
                      void navigate({
                        to: '/pipelines/agents',
                        search: { view: 'proposals', proposal: id },
                      })
                    }}
                    pendingAction={pendingPlan}
                  />
                </div>
              </details>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
