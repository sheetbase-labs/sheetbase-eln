import { z } from 'zod'

import { assistantToolsFrom } from '#/lib/operations/descriptor'

import { AI_PREFERENCE_OPERATIONS } from './operations'

/**
 * Preference cards for the assistant: remember one, change one, forget one.
 * Every one is a card: nothing is saved until the person presses its button,
 * which calls the ordinary RPC in their own browser session.
 */

export const AI_PREFERENCE_SAVE_TOOL = 'sheetbase.ai_preference.save'
export const AI_PREFERENCE_UPDATE_TOOL = 'sheetbase.ai_preference.update'
export const AI_PREFERENCE_DELETE_TOOL = 'sheetbase.ai_preference.delete'

export const AI_PREFERENCE_PROPOSE_TOOL_NAMES: readonly string[] =
  assistantToolsFrom(AI_PREFERENCE_OPERATIONS, 'propose')

export type AiPreferenceProposeToolName =
  | typeof AI_PREFERENCE_SAVE_TOOL
  | typeof AI_PREFERENCE_UPDATE_TOOL
  | typeof AI_PREFERENCE_DELETE_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const text = z.string().min(1).max(300)
const topic = z.string().max(60).optional()

export const proposeAiPreferenceSaveSchema = z.strictObject({
  title,
  summary,
  preference: text.describe(
    'The preference as one plain sentence the assistant can follow later, such as "96-well plates: blanks in column 12".',
  ),
  topic: topic.describe('A short label such as "Plate layout".'),
  scope: z
    .enum(['user', 'workspace'])
    .optional()
    .describe(
      'user (the default) is only for this person. workspace is for the whole lab and only for someone who manages the AI settings; use it only when the person said it is for everyone.',
    ),
})

export const proposeAiPreferenceUpdateSchema = z.strictObject({
  title,
  summary,
  existing: z
    .string()
    .min(1)
    .max(300)
    .describe('The saved preference to change, by its words or its topic.'),
  preference: text.describe('The new wording.'),
  topic: topic.describe('The new label, if it changes.'),
})

export const proposeAiPreferenceDeleteSchema = z.strictObject({
  title,
  summary,
  existing: z
    .string()
    .min(1)
    .max(300)
    .describe('The saved preference to forget, by its words or its topic.'),
})

export type AiPreferenceAction =
  | {
      kind: 'ai_preference.save'
      body: string
      topic: string | null
      scope: 'user' | 'workspace'
    }
  | {
      kind: 'ai_preference.update'
      preferenceId: string
      body: string
      topic: string | null
    }
  | { kind: 'ai_preference.delete'; preferenceId: string }

const KINDS: readonly string[] = [
  'ai_preference.save',
  'ai_preference.update',
  'ai_preference.delete',
]

export function isAiPreferenceAction(action: {
  kind: string
}): action is AiPreferenceAction {
  return KINDS.includes(action.kind)
}
