import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { invalid, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { findPipeline } from '#/lib/assistant-pipelines.server'
import type {
  AssistantProposal,
  ProposalChange,
} from '#/lib/assistant-proposals'
import { isIanaTimeZone } from '#/lib/pipeline-schedule'
import { parseStartRules } from '#/lib/pipelines/start-rules'
import type { StartRules } from '#/lib/pipelines/start-rules'

import {
  PIPELINE_START_RULES_TOOL,
  PIPELINE_STARTS_PROPOSE_TOOL_NAMES,
  proposeStartRulesSchema,
} from './cards'
import type {
  PipelineStartsAction,
  PipelineStartsProposeToolName,
} from './cards'

/**
 * The start-rule card (see `cards.ts`). The builder finds the pipeline the
 * model named under the person's own access, merges what they asked for into
 * the rules it has now, and returns a card that says what changes. Nothing is
 * written here; the button runs the ordinary call as the person.
 */

export type StartRulesOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isStartRulesProposalTool(
  name: string,
): name is PipelineStartsProposeToolName {
  return PIPELINE_STARTS_PROPOSE_TOOL_NAMES.includes(name)
}

export function startRulesProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PIPELINE_START_RULES_TOOL,
      `Propose changing when a pipeline may start: the days and hours it may start in, how many new rows a snapshot must add, how long to wait so a batch of imports runs once, and what to do about starts missed in an outage. Only what you give changes. ${NOTE}`,
      proposeStartRulesSchema,
    ),
  ]
}

const DAYS = {
  daily: 'every day',
  weekdays: 'weekdays',
  weekends: 'weekends',
} as const

/** The rules as lines a person reads; the same lines show before and after. */
interface RuleLines {
  [label: string]: string
}

function lines(rules: StartRules): RuleLines {
  return {
    Hours: rules.window
      ? `${DAYS[rules.window.days]} ${rules.window.from}–${rules.window.to} (${rules.window.timeZone})`
      : 'any time',
    'New rows': rules.minNewRows
      ? `at least ${rules.minNewRows}`
      : 'no minimum',
    Conditions: rules.conditionsMatch === 'all' ? 'all must hold' : 'any one',
    Wait:
      rules.waitMinutes > 0
        ? `${rules.waitMinutes} min after the last snapshot`
        : 'none',
    'Missed runs': rules.missedRuns === 'run_once' ? 'run once' : 'skip',
  }
}

export async function buildStartRulesProposal(
  name: PipelineStartsProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<StartRulesOutcome> {
  const parsed = proposeStartRulesSchema.safeParse(args)

  if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
  const input = parsed.data

  if (input.hours && input.hours.from >= input.hours.to)
    return { ok: false, message: 'The hours must open before they close.' }

  if (!isIanaTimeZone(context.timeZone))
    return { ok: false, message: 'The time zone could not be read.' }

  const found = await findPipeline(context, input.pipeline)

  if (!found.ok) return { ok: false, message: found.message }
  const pipeline = found.value

  const stored = await context.client.list<{ start_rules: unknown }>(
    'pipeline_definitions',
    `?id=eq.${encodeURIComponent(pipeline.id)}&select=start_rules&limit=1`,
  )

  const before = parseStartRules(stored.at(0)?.start_rules)

  const after: StartRules = {
    ...before,
    window:
      input.hours === undefined
        ? before.window
        : input.hours === null
          ? null
          : { ...input.hours, timeZone: context.timeZone },
    minNewRows:
      input.minNewRows === undefined ? before.minNewRows : input.minNewRows,
    waitMinutes: input.waitMinutes ?? before.waitMinutes,
    conditionsMatch: input.conditionsMatch ?? before.conditionsMatch,
    missedRuns: input.missedRuns ?? before.missedRuns,
  }

  const was = lines(before)
  const now = lines(after)

  const changes: ProposalChange[] = Object.keys(now)
    .filter((label) => was[label] !== now[label])
    .map((label) => ({ label, before: was[label], after: now[label] }))

  if (changes.length === 0)
    return { ok: false, message: 'Those are already the rules.' }

  const action: PipelineStartsAction = {
    kind: 'pipeline.start_rules',
    workspaceId: context.workspaceId,
    definitionId: pipeline.id,
    rules: after,
  }

  return {
    ok: true,
    proposal: {
      tool: name,
      title: input.title,
      summary: input.summary,
      target: `${pipeline.name} · Starts and runs`,
      deepLink: `/pipelines/${pipeline.id}/starts`,
      changes,
      action,
    },
  }
}
