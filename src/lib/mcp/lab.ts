import { z } from 'zod'

import type { Scope } from '../api-credential-scopes'
import type { DataClient } from '../data-client'
import { LAB_RPCS } from '../lab-api-surface'
import type { LabRpc, LabType } from '../lab-api-surface'

/**
 * MCP lab actions.
 *
 * One tool runs the lab RPCs on the external allowlist (`lab-api-surface.ts`):
 * ordering and receiving reagents, logging service visits, stocktakes,
 * shipments, workflows and the rest. It is the MCP face of the same list the
 * API and docs use, so an action added there is reachable here with no extra
 * wiring.
 *
 * It acts as the person a personal token belongs to, straight away, within
 * what that person may do (PostgreSQL RLS and the RPC's own role checks stay
 * authoritative). Because nothing waits for approval, a service credential is
 * refused, the credential must hold the action's scope, and the owner must
 * have switched on the `mcp_lab` workspace flag.
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

function argumentSchema(rpc: LabRpc): z.ZodType<Record<string, unknown>> {
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
    description: `Run a lab action as the person this token belongs to, straight away and within what they are allowed to do. Needs a personal token with lab:write (lab:read for lookups) and the workspace's "Agents can act in the lab" setting. Arguments use the p_ names of the matching API call; optional ones are marked ?. Read lab lists with sheetbase.canonical.read. Actions:\n${describeActions()}`,
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
  | { ok: true; action: string; result: unknown }
  | { ok: false; message: string; code?: string }

/**
 * Validate and run one lab action. The caller has already checked the
 * workspace flag and that the actor is a person.
 */
export async function runLabAct(
  input: unknown,
  scopes: readonly Scope[],
  client: DataClient,
): Promise<LabActOutcome> {
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
  const args = argumentSchema(rpc).safeParse(parsed.data.arguments)
  if (!args.success) {
    const first = args.error.issues[0]
    const where = first.path.join('.') || 'arguments'
    return {
      ok: false,
      message: `Invalid arguments for ${action}: ${where}: ${first.message}.`,
      code: 'invalid_arguments',
    }
  }
  const result = await client.rpc<unknown>(action, args.data)
  return { ok: true, action, result }
}
