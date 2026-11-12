import { z } from 'zod'

import { assistantToolsFrom } from '#/lib/operations/descriptor'

import { PARAMETER_SET_OPERATIONS } from './operations'

/**
 * Parameter sets from the assistant: save one (make it, or replace the one
 * with that key) and delete one. Each is a card; nothing happens until the
 * person presses its button, which calls the ordinary RPC in their own session.
 */

export const PARAMETER_SET_SAVE_TOOL = 'sheetbase.pipeline_parameter_set.save'

export const PARAMETER_SET_DELETE_TOOL =
  'sheetbase.pipeline_parameter_set.delete'

export const PARAMETER_SET_PROPOSE_TOOL_NAMES: readonly string[] =
  assistantToolsFrom(PARAMETER_SET_OPERATIONS, 'propose')

export type ParameterSetProposeToolName =
  typeof PARAMETER_SET_SAVE_TOOL | typeof PARAMETER_SET_DELETE_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

export const PARAMETER_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
] as const

export const proposeParameterSetSaveSchema = z.strictObject({
  title,
  summary,
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,63}$/)
    .describe(
      'The set’s key: lower-case letters, digits, - and _, starting with a letter. Pipelines include it by this.',
    ),
  name: z.string().min(1).max(200),
  description: z.string().max(400).optional(),
  parameters: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(64),
        type: z.enum(PARAMETER_TYPES),
        required: z.boolean(),
        default: z.union([z.string(), z.number(), z.boolean()]).optional(),
        description: z.string().max(200).optional(),
      }),
    )
    .max(50),
})

export const proposeParameterSetDeleteSchema = z.strictObject({
  title,
  summary,
  set: z.string().min(1).max(200).describe('The set, by its name or key.'),
})

export type ParameterSetAction =
  | {
      kind: 'parameter_set.save'
      workspaceId: string
      key: string
      name: string
      description: string | null
      parameters: z.infer<typeof proposeParameterSetSaveSchema>['parameters']
    }
  | { kind: 'parameter_set.delete'; workspaceId: string; setId: string }

const KINDS: readonly string[] = ['parameter_set.save', 'parameter_set.delete']

export function isParameterSetAction(action: {
  kind: string
}): action is ParameterSetAction {
  return KINDS.includes(action.kind)
}
