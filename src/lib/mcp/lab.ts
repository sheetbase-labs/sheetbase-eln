import { z } from 'zod'

import type { Scope } from '../api-credential-scopes'
import type { DataClient } from '../data-client'
import { LAB_RPCS } from '../lab-api-surface'
import type { LabRpc, LabType } from '../lab-api-surface'
import { prepareStructureArguments } from './compounds'

/**
 * MCP lab actions.
 *
 * One tool runs the lab RPCs on the external allowlist (`lab-api-surface.ts`):
 * ordering and receiving reagents, logging service visits, stocktakes,
 * shipments, workflows and the rest. It is the MCP face of the same list the
 * API and docs use, so an action added there is reachable here with no extra
 * wiring.
 *
 * It acts as the person a personal token belongs to, within what that person
 * may do (PostgreSQL RLS and the RPC's own role checks stay authoritative).
 * What happens to an action that changes something is the workspace's agent
 * permission for it: Auto runs now, Ask waits for a person to approve it, Never
 * is refused (see agent-action-policy.ts). A service credential is refused, the
 * credential must hold the action's scope, and the owner must have switched on
 * the `mcp_lab` workspace flag.
 */

export const LAB_ACT_TOOL_NAME = 'sheetbase.lab.act'

const ACTIONS = Object.keys(LAB_RPCS) as [string, ...string[]]

const DATE = /^\d{4}-\d{2}-\d{2}$/

function valueSchema(type: LabType): z.ZodType {
  switch (type) {
    case 'uuid':
      return z.string().uuid()
    case 'text':
    case 'ts':
    case 'time':
      return z.string()
    case 'date':
      return z.string().regex(DATE, 'Use YYYY-MM-DD.')
    case 'int':
    case 'bigint':
      return z.number().int()
    case 'num':
      return z.number()
    case 'bool':
      return z.boolean()
    case 'json':
      return z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    case 'text[]':
      return z.array(z.string())
    case 'int[]':
      return z.array(z.number().int())
    case 'uuid[]':
      return z.array(z.string().uuid())
  }
}

export function argumentSchema(
  rpc: LabRpc,
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {}
  for (const [name, type, required] of rpc.params) {
    const base = valueSchema(type)
    shape[name] = required ? base : base.optional()
  }
  return z.object(shape).strict()
}

function describeActions(): string {
  return ACTIONS.map((name) => {
    const rpc = LAB_RPCS[name]
    const params = rpc.params
      .map(([p, type, required]) => `${p}${required ? '' : '?'}: ${type}`)
      .join(', ')
    return `- ${name}(${params}): ${rpc.summary}.`
  }).join('\n')
}

export const labActSchema = z
  .object({
    action: z.enum(ACTIONS),
    arguments: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export function labActTool() {
  return {
    name: LAB_ACT_TOOL_NAME,
    description: `Run a lab action as the person this token belongs to, within what they are allowed to do. An action that changes something follows the workspace's agent permissions: it may run now, wait for a person to approve it, or be refused. Needs a personal token with lab:write (lab:read for lookups) and the workspace's "Agents can act in the lab" setting. Arguments use the p_ names of the matching API call; optional ones are marked ?. Read lab lists with sheetbase.canonical.read. Actions:\n${describeActions()}`,
    inputSchema: z.toJSONSchema(labActSchema, { io: 'input' }),
    annotations: {
      title: 'Run a lab action',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }
}

/** True when the credential could run at least one lab action. */
export function hasLabActScope(scopes: readonly Scope[]): boolean {
  return scopes.includes('lab:write') || scopes.includes('lab:read')
}

export type LabActOutcome =
  | { ok: true; action: string; result: unknown; request?: LabActRequest }
  | {
      ok: false
      message: string
      code?: string
      request?: LabActRequest
    }
  | {
      ok: 'waiting'
      action: string
      message: string
      request: LabActRequest
    }

export interface LabActRequest {
  id: string
  status: string
  level: string
}

interface Checked {
  action: string
  rpc: LabRpc
  args: Record<string, unknown>
}

async function checkLabAct(
  input: unknown,
  scopes: readonly Scope[],
): Promise<Checked | Extract<LabActOutcome, { ok: false }>> {
  const parsed = labActSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: 'The arguments do not match the lab action schema.',
      code: 'invalid_arguments',
    }
  }
  const { action } = parsed.data
  const rpc = LAB_RPCS[action]
  if (!scopes.includes(rpc.scope)) {
    return {
      ok: false,
      message: `This credential lacks the ${rpc.scope} scope required for ${action}.`,
    }
  }
  const prepared = await prepareStructureArguments(
    action,
    parsed.data.arguments,
  )
  if (!prepared.ok) {
    return { ok: false, message: prepared.message, code: 'invalid_arguments' }
  }
  const args = argumentSchema(rpc).safeParse(prepared.args)
  if (!args.success) {
    const first = args.error.issues[0]
    const where = first.path.join('.') || 'arguments'
    return {
      ok: false,
      message: `Invalid arguments for ${action}: ${where}: ${first.message}.`,
      code: 'invalid_arguments',
    }
  }
  return { action, rpc, args: args.data }
}

/**
 * Validate and run one lab action straight away. Used for lookups, and by
 * code that has already decided the action may run.
 */
export async function runLabAct(
  input: unknown,
  scopes: readonly Scope[],
  client: DataClient,
): Promise<LabActOutcome> {
  const checked = await checkLabAct(input, scopes)
  if ('ok' in checked) return checked
  const result = await client.rpc<unknown>(checked.action, checked.args)
  return { ok: true, action: checked.action, result }
}

export interface GuardedLabActContext {
  workspaceId: string
  /** Who is asking, for the record: the credential's id. */
  credentialId: string
  scopes: readonly Scope[]
  client: DataClient
}

/**
 * Run one lab action through the workspace's agent permissions. A lookup runs
 * at once. An action that changes something is recorded as a request, then:
 * Never is refused, Ask waits for a person to approve it in the Inbox, and Auto
 * runs now as the person the token belongs to and the outcome is recorded.
 */
export async function runGuardedLabAct(
  input: unknown,
  context: GuardedLabActContext,
): Promise<LabActOutcome> {
  const checked = await checkLabAct(input, context.scopes)
  if ('ok' in checked) return checked
  const { action, rpc, args } = checked
  if (
    rpc.scope !== 'lab:write' ||
    action === 'request_agent_action' ||
    action === 'finish_agent_action'
  ) {
    const result = await context.client.rpc<unknown>(action, args)
    return { ok: true, action, result }
  }

  // The same request, still waiting, is not asked twice.
  const waiting = await context.client.list<{
    id: string
    status: string
    level: string
    arguments: Record<string, unknown>
  }>(
    'agent_action_requests',
    `?select=id,status,level,arguments&status=eq.pending&action_key=eq.${encodeURIComponent(action)}&order=created_at.desc&limit=20`,
  )
  const same = waiting.find(
    (row) => JSON.stringify(row.arguments) === JSON.stringify(args),
  )
  if (same) {
    return {
      ok: 'waiting',
      action,
      message: WAITING_MESSAGE,
      request: { id: same.id, status: same.status, level: same.level },
    }
  }

  const request = await context.client.rpc<{
    id: string
    status: string
    level: string
  }>('request_agent_action', {
    p_workspace_id: context.workspaceId,
    p_action_key: action,
    p_arguments: args,
    p_summary: `${rpc.summary}${summariseArguments(args)}`.slice(0, 500),
    p_provenance: {
      agentId: `mcp:${context.credentialId}`,
      tool: LAB_ACT_TOOL_NAME,
    },
    p_idempotency_key: `mcp-${crypto.randomUUID()}`,
  })
  const ref: LabActRequest = {
    id: request.id,
    status: request.status,
    level: request.level,
  }
  if (request.status === 'refused') {
    return {
      ok: false,
      code: 'agent_action_never',
      message: `${rpc.summary} is switched off for agents in this workspace. A person can do it in Sheetbase.`,
      request: ref,
    }
  }
  if (request.status === 'pending') {
    return { ok: 'waiting', action, message: WAITING_MESSAGE, request: ref }
  }
  // Auto: run now, then record how it ended.
  try {
    const result = await context.client.rpc<unknown>(action, args)
    await context.client.rpc('finish_agent_action', {
      p_request_id: request.id,
      p_ok: true,
      p_result: result === undefined ? null : result,
      p_error: null,
    })
    return {
      ok: true,
      action,
      result,
      request: { ...ref, status: 'succeeded' },
    }
  } catch (error) {
    await context.client
      .rpc('finish_agent_action', {
        p_request_id: request.id,
        p_ok: false,
        p_result: null,
        p_error: error instanceof Error ? error.message : 'The action failed.',
      })
      .catch(() => undefined)
    throw error
  }
}

const WAITING_MESSAGE =
  'This is waiting for a person to approve it in Sheetbase (it is in their Inbox). Nothing has changed yet. Check the request later with sheetbase.canonical.read on agent_action_requests.'

export function summariseArguments(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, value]) => value !== null && value !== undefined)
    .slice(0, 6)
    .map(
      ([name, value]) =>
        `${name.replace(/^p_/, '').replace(/_/g, ' ')} ${
          typeof value === 'object' ? JSON.stringify(value) : String(value)
        }`,
    )
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}
