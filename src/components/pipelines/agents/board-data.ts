import { t } from '#/copy'
import { proposalStage } from '#/lib/agent-registry'
import type { AgentDefinition, AgentRun } from '#/lib/agent-registry'
import type { AgentOperationProposal } from '#/lib/agent-operations'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Number in a proposal's PR-0412 name, so the newest sorts first. */
function ordinal(proposal: AgentOperationProposal): number {
  return Number(/\d+/.exec(proposal.display_id ?? '')?.[0] ?? 0)
}

export function proposalBoardGroups(
  proposals: readonly AgentOperationProposal[],
  me: Parameters<typeof proposalStage>[1],
  now: Date,
) {
  const groups: Record<
    ReturnType<typeof proposalStage>,
    AgentOperationProposal[]
  > = {
    needs: [],
    waiting: [],
    decided: [],
  }

  for (const proposal of proposals) {
    const stage = proposalStage(proposal, me)

    if (
      stage === 'decided' &&
      now.getTime() - Date.parse(proposal.updated_at) > WEEK_MS
    )
      continue
    groups[stage].push(proposal)
  }

  const byNewest = (list: AgentOperationProposal[]) =>
    list.sort((a, b) => ordinal(b) - ordinal(a))

  const needsSignature = groups.needs.filter((p) => p.signature_required)
  const needsApproval = groups.needs.filter((p) => !p.signature_required)

  return [
    {
      stage: 'needs' as const,
      key: 'needs-approval',
      label: t('data.proposalsBoard.needsApproval'),
      items: byNewest(needsApproval),
    },
    {
      stage: 'needs' as const,
      key: 'needs-signature',
      label: t('data.proposalsBoard.needsSignature'),
      items: byNewest(needsSignature),
    },
    {
      stage: 'waiting' as const,
      key: 'waiting',
      label: t('data.proposalsBoard.waitingOthers'),
      items: byNewest(groups.waiting),
    },
    {
      stage: 'decided' as const,
      key: 'decided',
      label: t('data.proposalsBoard.decidedLast7Days'),
      items: byNewest(groups.decided),
    },
  ].filter((group) => group.items.length > 0)
}

/** Most recently run first, paused workflows last (runs arrive newest first). */
export function workflowOrder(
  definitions: readonly AgentDefinition[],
  runs: readonly AgentRun[],
) {
  const latest = (d: AgentDefinition) =>
    runs.find((r) => r.definition_id === d.id)?.started_at ?? ''

  return [...definitions].sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) ||
      latest(b).localeCompare(latest(a)),
  )
}
