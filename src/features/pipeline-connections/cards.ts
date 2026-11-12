import { z } from 'zod'

import { assistantToolsFrom } from '#/lib/operations/descriptor'

import { PIPELINE_CONNECTION_OPERATIONS } from './operations'

/**
 * Pipeline connections from the assistant: add an address pipelines may call,
 * switch one off or on or move it, and remove one. Every one is a card; the
 * button runs the ordinary call as the person. Secrets are never set here:
 * they are typed into Settings, so a value never passes through a chat.
 */
export const CONNECTION_ADD_TOOL = 'sheetbase.pipeline_connection.add'
export const CONNECTION_CHANGE_TOOL = 'sheetbase.pipeline_connection.change'
export const CONNECTION_REMOVE_TOOL = 'sheetbase.pipeline_connection.remove'
export const CONNECTIONS_READ_TOOL = 'sheetbase.pipeline_connections.list'

export const PIPELINE_CONNECTION_PROPOSE_TOOL_NAMES: readonly string[] =
  assistantToolsFrom(PIPELINE_CONNECTION_OPERATIONS, 'propose')

export type PipelineConnectionProposeToolName =
  | typeof CONNECTION_ADD_TOOL
  | typeof CONNECTION_CHANGE_TOOL
  | typeof CONNECTION_REMOVE_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

export const proposeConnectionAddSchema = z.strictObject({
  title,
  summary,
  key: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,48}$/)
    .describe('What pipeline steps call it: lowercase, such as lims.'),
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('What people call it, such as LIMS.'),
  baseUrl: z
    .string()
    .max(2048)
    .describe('The https address, such as https://lims.example.com/api.'),
  description: z.string().max(2000).optional(),
})

export const proposeConnectionChangeSchema = z.strictObject({
  title,
  summary,
  connection: z
    .string()
    .min(1)
    .max(200)
    .describe('The connection, by name or key.'),
  name: z.string().min(1).max(200).optional(),
  baseUrl: z.string().max(2048).optional(),
  status: z
    .enum(['active', 'off'])
    .optional()
    .describe(
      'off stops every web call that uses it; active turns it back on.',
    ),
})

export const proposeConnectionRemoveSchema = z.strictObject({
  title,
  summary,
  connection: z
    .string()
    .min(1)
    .max(200)
    .describe('The connection, by name or key.'),
})

export type PipelineConnectionAction =
  | {
      kind: 'pipeline_connection.add'
      workspaceId: string
      key: string
      name: string
      baseUrl: string
      description: string | null
    }
  | {
      kind: 'pipeline_connection.change'
      workspaceId: string
      connectionId: string
      name: string | null
      baseUrl: string | null
      status: 'active' | 'off' | null
    }
  | {
      kind: 'pipeline_connection.remove'
      workspaceId: string
      connectionId: string
    }

const KINDS: readonly string[] = [
  'pipeline_connection.add',
  'pipeline_connection.change',
  'pipeline_connection.remove',
]

export function isPipelineConnectionAction(action: {
  kind: string
}): action is PipelineConnectionAction {
  return KINDS.includes(action.kind)
}
