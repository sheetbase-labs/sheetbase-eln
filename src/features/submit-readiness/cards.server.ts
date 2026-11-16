import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { invalid, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { AssistantProposal } from '#/lib/assistant-proposals'

import {
  SUBMIT_READINESS_MODES,
  SUBMIT_READINESS_PROPOSE_TOOL_NAMES,
  SUBMIT_READINESS_TOOL,
  proposeSubmitReadinessSchema,
} from './cards'
import type {
  SubmitReadinessAction,
  SubmitReadinessMode,
  SubmitReadinessProposeToolName,
} from './cards'

/**
 * The readiness card (see `cards.ts`). The builder reads the rule now in force
 * under the person's own access and returns a card that says what changes.
 * Nothing is written here; the button runs the ordinary call as the person.
 */

export type SubmitReadinessOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

const WORDS: Record<SubmitReadinessMode, string> = {
  off: 'Not checked',
  warn: 'Listed, but the submission goes through',
  block: 'Listed, and the submission is refused until cleared',
}

export function isSubmitReadinessProposalTool(
  name: string,
): name is SubmitReadinessProposeToolName {
  return SUBMIT_READINESS_PROPOSE_TOOL_NAMES.includes(name)
}

export function submitReadinessProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      SUBMIT_READINESS_TOOL,
      `Propose changing whether open protocol steps and a missing decision stop an experiment being submitted for review: not checked, only listed, or refused until cleared. ${NOTE}`,
      proposeSubmitReadinessSchema,
    ),
  ]
}

export async function buildSubmitReadinessProposal(
  name: SubmitReadinessProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<SubmitReadinessOutcome> {
  const parsed = proposeSubmitReadinessSchema.safeParse(args)

  if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
  const input = parsed.data

  const stored = await context.client.list<{
    submit_readiness_mode: string | null
  }>(
    'workspace_settings',
    `?workspace_id=eq.${encodeURIComponent(context.workspaceId)}&select=submit_readiness_mode&limit=1`,
  )

  const before =
    SUBMIT_READINESS_MODES.find(
      (mode) => mode === stored.at(0)?.submit_readiness_mode,
    ) ?? 'warn'

  if (before === input.mode)
    return { ok: false, message: 'That is already the rule.' }

  const action: SubmitReadinessAction = {
    kind: 'submit_readiness.set',
    workspaceId: context.workspaceId,
    mode: input.mode,
  }

  return {
    ok: true,
    proposal: {
      tool: name,
      title: input.title,
      summary: input.summary,
      target: 'Signatures settings · Before submission',
      deepLink: '/settings/workspace/signatures',
      changes: [
        {
          label: 'Open steps and no decision',
          before: WORDS[before],
          after: WORDS[input.mode],
        },
      ],
      action,
    },
  }
}
