import { z } from 'zod'
import type { AgentOperation } from './agent-operations'
import { pipelineActions } from './operations/registry'
import { parsePluginName } from './extensions/points'
import { ExtensionRunError } from './extensions/runtime.server'
import type { ExecConnection } from './pipeline-execute.server'
import {
  pythonInputRowSchema,
  pythonInputValueSchema,
} from './pipeline-python.server'
import type { PythonInputValue } from './pipeline-python.server'
import { validatePipelineActions } from './pipelines/actions'
import type {
  PipelineAction,
  PipelineActionArgument,
} from './pipelines/actions'
import {
  pipelineJsonObjectSchema,
  pipelineJsonValueSchema,
} from './pipelines/types'

const actionContextSchema = z.object({
  parameters: pipelineJsonObjectSchema,
  previous: z.array(pythonInputValueSchema),
  output: pipelineJsonObjectSchema,
  /** Per action: the result of the data step before it, when it is not `previous`. */
  previousFor: z.record(z.string(), z.array(pythonInputValueSchema)).optional(),
})

export type PipelineActionContext = z.infer<typeof actionContextSchema>

const isObject = (
  value: PythonInputValue,
): value is z.infer<typeof pythonInputRowSchema> =>
  pythonInputRowSchema.safeParse(value).success

const blocked = new Set(['__proto__', 'prototype', 'constructor'])

const argumentContainerSchema = z.union([
  z.array(z.unknown()),
  z.custom<object>(
    (value) => z.record(z.string(), z.unknown()).safeParse(value).success,
  ),
])

// Check depth before the recursive JSON decoder can exhaust the JavaScript stack.
const actionArgumentSchema = z.preprocess((value) => {
  const pending = [{ value, depth: 0, key: '' }]

  while (pending.length) {
    const entry = pending.pop()

    if (!entry) break

    if (blocked.has(entry.key)) throw new Error('Invalid action argument key.')

    if (entry.depth > 32)
      throw new Error('Action arguments exceed the nesting limit.')
    const container = argumentContainerSchema.safeParse(entry.value)

    if (!container.success) continue

    if (Object.hasOwn(container.data, '$ref')) {
      if (
        Object.keys(container.data).length !== 1 ||
        !z.object({ $ref: z.string() }).safeParse(container.data).success
      )
        throw new Error('A reference must contain only a $ref path.')
      continue
    }

    const children = z
      .array(z.tuple([z.string(), z.unknown()]))
      .parse(Object.entries(container.data))

    for (const [key, child] of children.reverse())
      pending.push({ value: child, depth: entry.depth + 1, key })
  }

  return value
}, pipelineJsonValueSchema)

/** Explicit references preserve JSON value types; ordinary strings remain literal. */
export function resolvePipelineActionValue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Notification payloads and action arguments cross the JSON boundary here and are decoded immediately.
  value: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Executor/notification context is decoded at this boundary before any reference traversal.
  context: unknown,
  depth = 0,
) {
  const decoded = actionArgumentSchema.parse(value)
  const scope = pythonInputRowSchema.parse(context)

  return resolveValue(decoded, scope, depth)
}

function resolveValue(
  value: z.infer<typeof pipelineJsonValueSchema>,
  context: z.infer<typeof pythonInputRowSchema>,
  depth: number,
): PythonInputValue {
  if (depth > 32) throw new Error('Action arguments exceed the nesting limit.')

  if (Array.isArray(value))
    return value.map((entry) => resolveValue(entry, context, depth + 1))

  const object = pipelineJsonObjectSchema.safeParse(value)

  if (!object.success) return value

  if (Object.hasOwn(object.data, '$ref')) {
    const reference = z.string().safeParse(object.data.$ref)

    if (Object.keys(object.data).length !== 1 || !reference.success)
      throw new Error('A reference must contain only a $ref path.')
    const parts = reference.data.split('.')

    if (
      !['parameters', 'previous', 'actions', 'output', 'row'].includes(
        parts[0] ?? '',
      ) ||
      parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part) || blocked.has(part))
    )
      throw new Error('Invalid action reference.')
    let current: PythonInputValue = context

    for (const part of parts) {
      const bytes = z.instanceof(Buffer).safeParse(current)

      if (Array.isArray(current) && Object.hasOwn(current, part)) {
        current = part === 'length' ? current.length : current[Number(part)]
      } else if (bytes.success && Object.hasOwn(bytes.data, part)) {
        current = bytes.data[Number(part)]
      } else if (isObject(current) && Object.hasOwn(current, part)) {
        current = current[part]
      } else {
        throw new Error(`Action reference ${reference.data} was not found.`)
      }
    }

    return current
  }

  return Object.fromEntries(
    Object.entries(object.data).map(([key, entry]) => {
      if (blocked.has(key)) throw new Error('Invalid action argument key.')

      return [key, resolveValue(entry, context, depth + 1)]
    }),
  )
}

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

const sqlArgumentSchemas = {
  uuid: uuidSchema,
  text: z.string(),
  boolean: z.boolean(),
  integer: z
    .number()
    .refine((value) => Number.isSafeInteger(value) && value >= 1),
  bigint: z
    .number()
    .refine((value) => Number.isSafeInteger(value) && value >= 1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timestamptz: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}(:?\d{2})?)?)?$/)
    .refine((value) => !Number.isNaN(Date.parse(value))),
  numeric: z.number(),
  'text[]': z.array(z.string()),
  'uuid[]': z.array(uuidSchema),
  jsonb: pythonInputValueSchema.refine((value) => value !== undefined),
} satisfies Record<PipelineActionArgument['type'], z.ZodType>

function sqlValue(field: PipelineActionArgument, value: PythonInputValue) {
  if (value === null && field.nullable) return null
  const decoded = sqlArgumentSchemas[field.type].safeParse(value)

  if (!decoded.success)
    throw new Error(`Invalid ${field.name}: expected ${field.type}.`)

  return field.type === 'jsonb' ? JSON.stringify(decoded.data) : decoded.data
}

/**
 * PIPE-03.1 — the operation a proposal carries for an action.
 *
 * Only kinds the proposal contract can validate and execute are buildable here; an
 * operation with no `proposalKind` cannot be proposed at all, which validation refuses
 * before the run starts.
 */
function proposalOperation(
  proposalKind: string,
  resolved: z.infer<typeof pythonInputRowSchema>,
) {
  if (proposalKind === 'notebook_block.insert') {
    const expectedRevision = z
      .number()
      .safeParse(resolved.p_expected_structure_version)

    if (!expectedRevision.success)
      throw new Error(
        'A proposed block insert needs p_expected_structure_version: the proposal records the revision the pipeline saw.',
      )

    return {
      kind: 'notebook_block.insert',
      recordId: uuidSchema.parse(resolved.p_record_id),
      afterBlockId: uuidSchema
        .nullable()
        .parse(resolved.p_after_block_id ?? null),
      block: {
        type: z.string().parse(resolved.p_type),
        payload: pipelineJsonObjectSchema.parse(
          JSON.parse(z.string().parse(JSON.stringify(resolved.p_payload))),
        ),
        payloadSchemaVersion: sqlArgumentSchemas.integer.parse(
          resolved.p_payload_schema_version ?? 1,
        ),
      },
      expectedRevision: expectedRevision.data,
    } satisfies Extract<AgentOperation, { kind: 'notebook_block.insert' }>
  }

  // The money proposals leave out whatever the pipeline left empty, so the proposal
  // says only what the pipeline means to change.
  const optionalText = z.string().optional()
  const optionalNumber = z.number().optional()

  if (proposalKind === 'reagent_order.mark_ordered')
    return {
      kind: proposalKind,
      orderId: uuidSchema.parse(resolved.p_order_id),
      orderReference: optionalText.parse(
        resolved.p_order_reference ?? undefined,
      ),
      expectedOn: sqlArgumentSchemas.date
        .optional()
        .parse(resolved.p_expected_on ?? undefined),
      supplier: optionalText.parse(resolved.p_supplier ?? undefined),
      supplierRecordId: uuidSchema
        .optional()
        .parse(resolved.p_supplier_record_id ?? undefined),
      totalPrice: optionalNumber.parse(resolved.p_total_price ?? undefined),
      currency: optionalText.parse(resolved.p_currency ?? undefined),
    } satisfies Extract<AgentOperation, { kind: 'reagent_order.mark_ordered' }>

  if (proposalKind === 'reagent_order.set_price')
    return {
      kind: proposalKind,
      orderId: uuidSchema.parse(resolved.p_order_id),
      totalPrice: z
        .number()
        .nullable()
        .parse(resolved.p_total_price ?? null),
      currency: optionalText.parse(resolved.p_currency ?? undefined),
    } satisfies Extract<AgentOperation, { kind: 'reagent_order.set_price' }>

  if (proposalKind === 'instrument_rate.set')
    return {
      kind: proposalKind,
      instrumentId: uuidSchema.parse(resolved.p_instrument_id),
      ratePerHour: z
        .number()
        .nullable()
        .parse(resolved.p_rate_per_hour ?? null),
      currency: optionalText.parse(resolved.p_currency ?? undefined),
    } satisfies Extract<AgentOperation, { kind: 'instrument_rate.set' }>
  throw new Error(`No proposal form is implemented for ${proposalKind}.`)
}

/** Writes the proposal for a `propose` action, in place of calling its RPC. */
async function proposePipelineAction(
  conn: ExecConnection,
  run: { workspaceId: string; runId: string },
  action: PipelineAction,
  definition: { operation: string; label: string; proposalKind?: string },
  resolved: z.infer<typeof pythonInputRowSchema>,
  suffix = '',
) {
  const provenance = await conn.query<{
    definition_id: string
    definition_name: string
    version_id: string
  }>(
    `SELECT d.id AS definition_id, d.name AS definition_name, v.id AS version_id
       FROM api.pipeline_runs r
       JOIN api.pipeline_definition_versions v ON v.id = r.definition_version_id
       JOIN api.pipeline_definitions d ON d.id = v.definition_id
      WHERE r.id = $1`,
    [run.runId],
  )

  const row = provenance.rows.at(0)

  if (!row)
    throw new Error('The run has no Pipeline Definition to attribute to.')

  const response = await conn.query<{ result: unknown }>(
    `SELECT to_jsonb(api.propose_agent_operation(
       $1, $2, $3, $4::jsonb, $5::jsonb, $6
     )) AS result`,
    [
      run.workspaceId,
      `${definition.label} (${action.name})`,
      `Proposed by the ${row.definition_name} pipeline, run ${run.runId}.`,
      JSON.stringify(
        proposalOperation(z.string().parse(definition.proposalKind), resolved),
      ),
      JSON.stringify({
        kind: 'pipeline',
        pipelineId: row.definition_id,
        pipelineName: row.definition_name,
        definitionVersionId: row.version_id,
        runId: run.runId,
        invocationId: `${run.runId}:${action.name}${suffix}`,
      }),
      `pipeline:${run.runId}:${action.name}${suffix}`,
    ],
  )

  const result = pipelineJsonObjectSchema.safeParse(response.rows.at(0)?.result)

  if (!result.success || !z.string().safeParse(result.data.id).success)
    throw new Error(
      `Action ${action.name} (${definition.label}) could not be proposed.`,
    )

  return result.data
}

/** Caller owns the transaction: any thrown action failure must roll back all run work. */
export async function executePipelineActions(
  conn: ExecConnection,
  run: { workspaceId: string; runId: string },
  actions: PipelineAction[],
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Executor context is decoded immediately, retaining raw scientific pg values until selected arguments are validated.
  context: unknown,
) {
  const decodedContext = actionContextSchema.parse(context)
  const errors = validatePipelineActions(actions, run.workspaceId)

  if (errors.length) throw new Error(errors.join(' '))
  const available = pipelineActions(run.workspaceId)
  const results: z.infer<typeof pipelineJsonObjectSchema> = {}

  if (!actions.length) return results

  const identity = await conn.query<{ workspace_id: string; user_id: string }>(
    'SELECT api.current_workspace_id() AS workspace_id, api.current_user_id() AS user_id',
  )

  if (
    identity.rows.at(0)?.workspace_id !== run.workspaceId ||
    !identity.rows.at(0)?.user_id
  )
    throw new Error('Pipeline action identity does not match its workspace.')
  const actorUserId = identity.rows[0].user_id
  // Some canonical RPCs are invoker functions. A claims-only superuser call
  // would bypass their RLS; execute the catalogue as the authenticated role.
  await conn.query('SET LOCAL ROLE authenticated')

  try {
    // One action for one set of arguments: the RPC call, or a proposal of it.
    const runOnce = async (
      action: PipelineAction,
      scope: z.infer<typeof pythonInputRowSchema>,
      suffix: string,
    ) => {
      const resolved = pythonInputRowSchema.parse(
        resolvePipelineActionValue(action.arguments, scope),
      )

      // An action an extension added: the extension runs it, signed or in the
      // isolated Python runner, and its answer is the step's result.
      const extensionName = parsePluginName(action.operation)

      if (extensionName) {
        try {
          const { invokeWithHostCalls, personClient } =
            await import('./extensions/operation-host.server')

          const hosted = await invokeWithHostCalls(
            {
              workspaceId: run.workspaceId,
              actorUserId,
              extensionKey: extensionName.key,
              itemId: extensionName.id,
              input: resolved,
            },
            {
              workspaceId: run.workspaceId,
              userId: actorUserId,
              approve: 'all',
              client: () => personClient(run.workspaceId, actorUserId),
            },
          )

          if (hosted.kind === 'confirm')
            throw new Error('The plugin action could not carry on.')

          return pipelineJsonObjectSchema.parse(hosted.result.output)
        } catch (error) {
          const reason =
            error instanceof ExtensionRunError || error instanceof Error
              ? error.message
              : String(error)

          throw new Error(
            `Action ${action.name} (${action.operation}): ${reason}`,
          )
        }
      }

      const definition = available.find(
        (entry) => entry.operation === action.operation,
      )

      if (!definition)
        throw new Error(`Unsupported action operation: ${action.operation}.`)

      if (action.mode === 'propose')
        return proposePipelineAction(
          conn,
          run,
          action,
          definition,
          resolved,
          suffix,
        )
      const values: Array<ReturnType<typeof sqlValue>> = []
      const named: string[] = []

      for (const field of definition.arguments) {
        if (!field.server && !Object.hasOwn(resolved, field.name)) continue

        const value = field.server
          ? field.server === 'workspace'
            ? run.workspaceId
            : `pipeline:${run.runId}:${action.name}${suffix}`
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

      const result = pipelineJsonValueSchema
        .optional()
        .parse(response.rows.at(0)?.result)

      if (
        result === undefined ||
        result === null ||
        (isObject(result) && result.ok === false)
      )
        throw new Error(
          `Action ${action.name} (${definition.label}) was rejected.`,
        )

      if (isObject(result) && definition.omitFromResult) {
        const kept = { ...result }

        for (const key of definition.omitFromResult) delete kept[key]

        return kept
      }

      return result
    }

    const { previousFor, ...shared } = decodedContext

    for (const action of actions) {
      const own = previousFor?.[action.name]
      const scope = { ...shared, actions: results }

      if (own) scope.previous = own

      if (!action.forEach) {
        results[action.name] = await runOnce(action, scope, '')
        continue
      }

      // Bulk import: the same action for each row. A failing row throws, and the caller
      // rolls back every row, so an import is all or nothing.
      const rows = resolvePipelineActionValue(action.forEach, scope)

      if (!Array.isArray(rows) || !rows.every(isObject))
        throw new Error(
          `Action ${action.name} repeats for each row, but its list is not a list of rows.`,
        )

      const each: Array<Awaited<ReturnType<typeof runOnce>>> = []

      for (const [index, row] of rows.entries()) {
        try {
          each.push(await runOnce(action, { ...scope, row }, `:${index}`))
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          throw new Error(`Row ${index + 1} of ${rows.length}: ${reason}`)
        }
      }

      results[action.name] = each
    }
  } finally {
    // ROLLBACK TO the caller savepoint also restores the role after SQL errors.
    await conn.query('SET ROLE NONE').catch(() => {})
  }

  return results
}
