import type { ExecConnection } from './pipeline-execute.server'
import { PIPELINE_ACTIONS, validatePipelineActions } from './pipelines/actions'
import type {
  PipelineAction,
  PipelineActionArgument,
} from './pipelines/actions'

export interface PipelineActionContext {
  parameters: Record<string, unknown>
  previous: Array<Record<string, unknown>>
  output: Record<string, unknown>
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const blocked = new Set(['__proto__', 'prototype', 'constructor'])
/** Explicit references preserve JSON value types; ordinary strings remain literal. */
export function resolvePipelineActionValue(
  value: unknown,
  context: Record<string, unknown>,
  depth = 0,
): unknown {
  if (depth > 32) throw new Error('Action arguments exceed the nesting limit.')
  if (Array.isArray(value))
    return value.map((entry) =>
      resolvePipelineActionValue(entry, context, depth + 1),
    )
  if (!isObject(value)) return value
  if (Object.hasOwn(value, '$ref')) {
    if (Object.keys(value).length !== 1 || typeof value.$ref !== 'string')
      throw new Error('A reference must contain only a $ref path.')
    const parts = value.$ref.split('.')
    if (
      !['parameters', 'previous', 'actions', 'output'].includes(
        parts[0] ?? '',
      ) ||
      parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part) || blocked.has(part))
    )
      throw new Error('Invalid action reference.')
    let current: unknown = context
    for (const part of parts) {
      if (
        typeof current !== 'object' ||
        current === null ||
        !Object.hasOwn(current, part)
      )
        throw new Error(`Action reference ${value.$ref} was not found.`)
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (blocked.has(key)) throw new Error('Invalid action argument key.')
      return [key, resolvePipelineActionValue(entry, context, depth + 1)]
    }),
  )
}
function sqlValue(field: PipelineActionArgument, value: unknown): unknown {
  if (value === null && field.nullable) return null
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let valid = false
  switch (field.type) {
    case 'uuid':
      valid = typeof value === 'string' && uuid.test(value)
      break
    case 'text':
      valid = typeof value === 'string'
      break
    case 'integer':
    case 'bigint':
      valid =
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
      break
    case 'numeric':
      valid = typeof value === 'number' && Number.isFinite(value)
      break
    case 'text[]':
      valid =
        Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string')
      break
    case 'jsonb':
      valid = value !== undefined
      break
  }
  if (!valid) throw new Error(`Invalid ${field.name}: expected ${field.type}.`)
  return field.type === 'jsonb' ? JSON.stringify(value) : value
}

/** Caller owns the transaction: any thrown action failure must roll back all run work. */
export async function executePipelineActions(
  conn: ExecConnection,
  run: { workspaceId: string; runId: string },
  actions: PipelineAction[],
  context: PipelineActionContext,
): Promise<Record<string, unknown>> {
  const errors = validatePipelineActions(actions)
  if (errors.length) throw new Error(errors.join(' '))
  const results: Record<string, unknown> = {}
  if (!actions.length) return results
  const identity = await conn.query<{ workspace_id: string; user_id: string }>(
    'SELECT api.current_workspace_id() AS workspace_id, api.current_user_id() AS user_id',
  )
  if (
    identity.rows.at(0)?.workspace_id !== run.workspaceId ||
    !identity.rows.at(0)?.user_id
  )
    throw new Error('Pipeline action identity does not match its workspace.')
  // Some canonical RPCs are invoker functions. A claims-only superuser call
  // would bypass their RLS; execute the catalogue as the authenticated role.
  await conn.query('SET LOCAL ROLE authenticated')
  try {
    for (const action of actions) {
      const definition = PIPELINE_ACTIONS.find(
        (entry) => entry.operation === action.operation,
      )!
      const resolved = resolvePipelineActionValue(action.arguments, {
        ...context,
        actions: results,
      }) as Record<string, unknown>
      const values: unknown[] = []
      const named: string[] = []
      for (const field of definition.arguments) {
        if (!field.server && !Object.hasOwn(resolved, field.name)) continue
        const value = field.server
          ? `pipeline:${run.runId}:${action.name}`
          : resolved[field.name]
        values.push(sqlValue(field, value))
        named.push(`${field.name} => $${values.length}::${field.type}`)
      }
      // Function/argument/type identifiers originate only in the fixed catalogue;
      // every authored or referenced value remains a bound SQL parameter.
      const response = await conn.query<{ result: unknown }>(
        `SELECT to_jsonb(api.${definition.rpc}(${named.join(', ')})) AS result`,
        values,
      )
      const result = response.rows.at(0)?.result
      if (
        result === undefined ||
        result === null ||
        (isObject(result) && result.ok === false)
      )
        throw new Error(
          `Action ${action.name} (${definition.label}) was rejected.`,
        )
      results[action.name] = result
    }
  } finally {
    // ROLLBACK TO the caller savepoint also restores the role after SQL errors.
    await conn.query('SET ROLE NONE').catch(() => {})
  }
  return results
}
