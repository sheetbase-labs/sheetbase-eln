import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type {
  AssistantProposal,
  ProposalChange,
} from '#/lib/assistant-proposals'
import { parse, pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'

import {
  AI_PREFERENCE_DELETE_TOOL,
  AI_PREFERENCE_PROPOSE_TOOL_NAMES,
  AI_PREFERENCE_SAVE_TOOL,
  AI_PREFERENCE_UPDATE_TOOL,
  proposeAiPreferenceDeleteSchema,
  proposeAiPreferenceSaveSchema,
  proposeAiPreferenceUpdateSchema,
} from './cards'
import type { AiPreferenceAction, AiPreferenceProposeToolName } from './cards'
import type { AiPreferenceRow } from './preferences.server'

/**
 * Cards for the assistant's memory (see `cards.ts`). Each builder checks what
 * is already saved and returns a card that says exactly what will be kept,
 * changed or forgotten. Nothing is written here.
 */

export type AiPreferenceOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing is saved until they do.'

const PAGE = '/settings/account/ai-preferences'

const SCOPE_WORDS = {
  user: 'Only you',
  workspace: 'Everyone in the lab',
} as const

export function isAiPreferenceProposalTool(
  name: string,
): name is AiPreferenceProposeToolName {
  return AI_PREFERENCE_PROPOSE_TOOL_NAMES.includes(name)
}

export function aiPreferenceProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      AI_PREFERENCE_SAVE_TOOL,
      `Propose remembering how the person or the lab likes something done, so later plans start from it: a default plate layout, a naming pattern, the usual controls, a preferred unit. Use it when they state a standing preference or correct you in a way that will apply next time ("always put blanks in column 12"). Propose one preference per card, in one plain sentence. Never save one-off details, results, passwords, personal data or anything about what you are allowed to do. Check the saved preferences first and do not save a duplicate. Choose scope user unless they said it is for the whole lab. ${NOTE}`,
      proposeAiPreferenceSaveSchema,
    ),
    toolDef(
      AI_PREFERENCE_UPDATE_TOOL,
      `Propose rewording a saved preference when the person says it has changed. ${NOTE}`,
      proposeAiPreferenceUpdateSchema,
    ),
    toolDef(
      AI_PREFERENCE_DELETE_TOOL,
      `Propose forgetting a saved preference the person no longer wants followed. ${NOTE}`,
      proposeAiPreferenceDeleteSchema,
    ),
  ]
}

const fail = (message: string): AiPreferenceOutcome => ({ ok: false, message })

function card(
  tool: AiPreferenceProposeToolName,
  input: { title: string; summary: string },
  rest: {
    target: string
    changes: ProposalChange[]
    action: AiPreferenceAction
  },
): AiPreferenceOutcome {
  return {
    ok: true,
    proposal: {
      tool,
      title: input.title,
      summary: input.summary,
      deepLink: PAGE,
      ...rest,
    },
  }
}

async function findPreference(
  client: DataClient,
  text: string,
): Promise<Lookup<AiPreferenceRow>> {
  const like = likeValue(text)

  const rows = await client.list<AiPreferenceRow>(
    'ai_preferences',
    `?or=(body.ilike.${like},topic.ilike.${like})&select=id,scope,topic,body,updated_at&order=created_at.asc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'saved preference',
    (row) => row.body,
    (row) =>
      row.body.toLowerCase() === lower ||
      (row.topic ?? '').toLowerCase() === lower,
  )
}

const label = (row: { topic: string | null; body: string }) =>
  row.topic ? `${row.topic}: ${row.body}` : row.body

/** Whether the person may save for the whole lab, so a card never promises it falsely. */
async function managesAi(
  client: DataClient,
  workspaceId: string,
): Promise<boolean> {
  try {
    return await client.rpc<boolean>('has_settings_access', {
      p_workspace_id: workspaceId,
      p_area: 'ai',
      p_level: 'manage',
    })
  } catch {
    return false
  }
}

export async function buildAiPreferenceProposal(
  name: AiPreferenceProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Each tool case parses raw input before using it or accessing data.
  args: unknown,
  context: LabToolContext,
): Promise<AiPreferenceOutcome> {
  const { client, workspaceId } = context

  switch (name) {
    case AI_PREFERENCE_SAVE_TOOL: {
      const parsed = parse(proposeAiPreferenceSaveSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const scope = input.scope ?? 'user'
      const body = input.preference.trim()
      const topic = input.topic?.trim() || null

      if (scope === 'workspace' && !(await managesAi(client, workspaceId))) {
        return fail(
          'Only someone who manages the AI settings can save a preference for the whole lab. Offer to save it for just this person instead.',
        )
      }

      const saved = await client.list<AiPreferenceRow>(
        'ai_preferences',
        '?select=id,scope,topic,body,updated_at',
      )

      if (
        saved.some(
          (row) =>
            row.scope === scope &&
            row.body.trim().toLowerCase() === body.toLowerCase(),
        )
      ) {
        return fail('That preference is already saved.')
      }

      if (saved.filter((row) => row.scope === scope).length >= 25) {
        return fail(
          'There are 25 preferences saved already. Ask which one to forget first.',
        )
      }

      return card(name, input, {
        target: topic ?? 'Preference',
        changes: [
          { label: 'Remember', before: null, after: body },
          { label: 'For', before: null, after: SCOPE_WORDS[scope] },
        ],
        action: { kind: 'ai_preference.save', body, topic, scope },
      })
    }

    case AI_PREFERENCE_UPDATE_TOOL: {
      const parsed = parse(proposeAiPreferenceUpdateSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const found = await findPreference(client, input.existing)

      if (!found.ok) return fail(found.message)
      const body = input.preference.trim()
      const topic = input.topic?.trim() || found.value.topic

      return card(name, input, {
        target: found.value.topic ?? 'Preference',
        changes: [
          {
            label: 'Preference',
            before: label(found.value),
            after: label({ topic, body }),
          },
        ],
        action: {
          kind: 'ai_preference.update',
          preferenceId: found.value.id,
          body,
          topic,
        },
      })
    }

    case AI_PREFERENCE_DELETE_TOOL: {
      const parsed = parse(proposeAiPreferenceDeleteSchema, args)

      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const found = await findPreference(client, input.existing)

      if (!found.ok) return fail(found.message)

      return card(name, input, {
        target: found.value.topic ?? 'Preference',
        changes: [
          {
            label: 'Preference',
            before: label(found.value),
            after: 'Forgotten',
          },
          {
            label: 'Was for',
            before: null,
            after: SCOPE_WORDS[found.value.scope],
          },
        ],
        action: { kind: 'ai_preference.delete', preferenceId: found.value.id },
      })
    }
  }
}
