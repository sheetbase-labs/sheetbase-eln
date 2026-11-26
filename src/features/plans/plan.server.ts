/**
 * The plan card, server half: checks the steps the model listed and sends back
 * one card that carries them. Nothing is built or written here. Each step is
 * built when its turn comes (`step.ts`), so it can name what an earlier step
 * made.
 */
import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { parse } from '#/lib/assistant-upkeep.server'
import type { AssistantProposal } from '#/lib/assistant-proposals'
import type { DataClient } from '#/lib/data-client'

import { FEATURE_ASSISTANT_SERVERS } from '../assistant.server.gen'
import {
  PLAN_PAUSE_DESTRUCTIVE,
  PLAN_RUN_ALL,
  PLAN_TOOL,
  isDestructiveStep,
  isPersonalStep,
  proposePlanSchema,
} from './plan'
import type { PlanAction } from './plan'

export type PlanOutcome =
  | { ok: true; proposal: AssistantProposal }
  | { ok: false; message: string }

const DESCRIPTION =
  'Propose several changes that depend on each other as ONE card the person approves once; the steps then run in order and stop if one fails. Use it when the request needs more than one change and a later one uses what an earlier one makes, for example "create an experiment, add samples to it, then add an analysis". Put what others depend on first (the experiment), then what goes into it (the samples, naming that experiment), then what comes after (the analysis). Each step is a card tool of its own with its arguments written as usual; name what an earlier step makes by the name you gave it. For one change use that change’s own tool. Deciding, approving and signing are never steps.'

export function planProposalDefs(): ProviderToolDef[] {
  return [toolDef(PLAN_TOOL, DESCRIPTION, proposePlanSchema)]
}

export function isPlanProposalTool(name: string): boolean {
  return name === PLAN_TOOL
}

/** Every card tool a step may use: the assistant's own and each feature's. */
export function planStepTools(): ReadonlySet<string> {
  const features = FEATURE_ASSISTANT_SERVERS.flatMap((feature) =>
    (feature.proposalDefs?.() ?? []).map((def) =>
      def.name.replaceAll('__', '.'),
    ),
  )

  return new Set(
    [...ASSISTANT_PROPOSE_TOOL_NAMES, ...features].filter(
      (name) => name !== PLAN_TOOL,
    ),
  )
}

/**
 * The workspace rule that applies to this person, from the agent permissions:
 * the level resolved for their role. An unset rule is Ask, which for these two
 * means "pause at a destructive step" and "no Run all button".
 */
async function level(
  client: DataClient,
  workspaceId: string,
  key: string,
): Promise<'auto' | 'ask' | 'never'> {
  try {
    const answer = await client.rpc<string>('resolve_agent_action_level', {
      p_workspace_id: workspaceId,
      p_action_key: key,
    })

    return answer === 'auto' || answer === 'never' ? answer : 'ask'
  } catch {
    return 'ask'
  }
}

export async function buildPlanProposal(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The tool case parses raw model arguments before using them.
  args: unknown,
  context: LabToolContext,
): Promise<PlanOutcome> {
  const parsed = parse(proposePlanSchema, args)

  if (!parsed.ok) return { ok: false, message: parsed.message }

  // The model sometimes writes a step's tool the way the provider spells it
  // (`sheetbase__project__create`); a plan names tools with dots.
  const input = {
    ...parsed.data,
    steps: parsed.data.steps.map((step) => ({
      ...step,
      tool: step.tool.replaceAll('__', '.'),
    })),
  }

  const allowed = planStepTools()

  const [pause, runAll] = await Promise.all([
    level(context.client, context.workspaceId, PLAN_PAUSE_DESTRUCTIVE),
    level(context.client, context.workspaceId, PLAN_RUN_ALL),
  ])

  for (const [index, step] of input.steps.entries()) {
    if (isPersonalStep(step.tool)) {
      return {
        ok: false,
        message: `Step ${index + 1} (${step.tool}) is a person’s own decision, so a plan cannot carry it. Leave it out and offer it as its own card once the plan has run.`,
      }
    }

    if (!allowed.has(step.tool)) {
      return {
        ok: false,
        message: `Step ${index + 1} uses ${step.tool}, which is not a card tool a plan can run. Use the tool you would have used for that change on its own.`,
      }
    }

    if (isDestructiveStep(step.tool) && pause === 'never') {
      return {
        ok: false,
        message: `Step ${index + 1} (${step.title}) removes or ends something, and this workspace does not let plans do that. Offer it as a card of its own.`,
      }
    }
  }

  const action: PlanAction = {
    kind: 'plan.run',
    workspaceId: context.workspaceId,
    pauseDestructive: pause !== 'auto',
    runAllAllowed: runAll === 'auto',
    steps: input.steps.map((step, index) => ({
      key: `step-${index + 1}`,
      title: step.title,
      tool: step.tool,
      arguments: step.arguments,
      destructive: isDestructiveStep(step.tool),
    })),
  }

  return {
    ok: true,
    proposal: {
      tool: PLAN_TOOL,
      title: input.title,
      summary: input.summary,
      target: `${input.steps.length} steps`,
      deepLink: null,
      changes: action.steps.map((step, index) => ({
        label: `${index + 1}. ${step.title}`,
        before: null,
        after:
          step.destructive && action.pauseDestructive
            ? 'Waits for your OK'
            : 'Runs in order',
      })),
      action,
    },
  }
}
