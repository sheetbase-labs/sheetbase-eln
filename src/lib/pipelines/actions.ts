import { z } from 'zod'

import { t } from '#/copy'
import { pipelineActionsFrom } from '#/lib/operations/descriptor'
import { CORE_OPERATIONS, pipelineActions } from '#/lib/operations/registry'
import { parsePluginName } from '#/lib/extensions/points'

/** Browser-safe catalogue of governed ELN operations available to pipeline actions. */
export interface PipelineAction {
  name: string
  operation: string
  arguments: Record<string, z.core.util.JSONType>
  /**
   * PIPE-03.1 — what the step does with the action. `execute` (the default) calls the
   * canonical RPC; `propose` writes a proposal instead, so a person decides. Only an
   * operation with a `proposalKind` can be proposed, because a proposal's operation has
   * to be something the proposal contract can validate and execute.
   */
  mode?: 'execute' | 'propose'
  /**
   * Bulk import: run the action once for each row of a list, such as the rows the step
   * before it returned (`{ "$ref": "previous" }`). Arguments name a value from the current
   * row with `{ "$ref": "row.column" }`. All the rows succeed or none do, and a person
   * decides each one when the action proposes.
   */
  forEach?: { $ref: string }
}

/** Where a row loop may take its rows from. */
export const PIPELINE_ACTION_ROW_SOURCES = [
  'previous',
  'parameters',
  'output',
  'actions',
]

export type PipelineActionArgumentType =
  | 'uuid'
  | 'text'
  | 'boolean'
  | 'date'
  | 'timestamptz'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'jsonb'
  | 'text[]'
  | 'uuid[]'

export interface PipelineActionArgument {
  name: string
  type: PipelineActionArgumentType
  required: boolean
  nullable?: boolean
  server?: 'idempotency' | 'workspace'
}

export interface PipelineActionDefinition {
  operation: string
  rpc: string
  label: string
  description: string
  arguments: PipelineActionArgument[]
  /** The proposal kind this operation becomes when a step proposes it. */
  proposalKind?: string
  /** Keys left out of the step's result before it is kept (a one-time secret). */
  omitFromResult?: readonly string[]
}

/**
 * The built-in pipeline actions. Each is generated from an operation
 * declaration in `#/lib/operations`; to add one, declare the operation with a
 * `pipeline` half. Use `pipelineActions(workspaceId)` where extension actions
 * should be included.
 */
export const PIPELINE_ACTIONS: PipelineActionDefinition[] =
  pipelineActionsFrom(CORE_OPERATIONS)

const actionName = /^[a-z][a-z0-9_]{0,47}$/

const rawActionSchema = z
  .looseObject({
    name: z.unknown(),
    operation: z.unknown(),
    arguments: z.unknown(),
    mode: z.unknown(),
    forEach: z.unknown(),
  })
  .partial()

const actionListSchema = z.array(z.unknown()).max(20)

const actionItemSchema = z.union([
  rawActionSchema,
  z.array(z.unknown()).transform(() => rawActionSchema.parse({})),
])

const actionArgumentsEnvelopeSchema = z.looseObject({})

// Retain original own keys: looseObject clones omit __proto__, which still
// needs an editable-argument error or counts as an extra row-reference key.
const actionArgumentsSchema = z.custom<
  z.infer<typeof actionArgumentsEnvelopeSchema>
>((value) => actionArgumentsEnvelopeSchema.safeParse(value).success)

const rowLoopEnvelopeSchema = z.looseObject({ $ref: z.string() })

const rowLoopSchema = z
  .custom<z.infer<typeof rowLoopEnvelopeSchema>>(
    (value) => rowLoopEnvelopeSchema.safeParse(value).success,
  )
  .refine((value) => {
    const parts = value.$ref.split('.')

    return (
      Object.keys(value).length === 1 &&
      PIPELINE_ACTION_ROW_SOURCES.includes(parts[0]) &&
      parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
    )
  })

function validateRowLoop(
  loop: z.ZodSafeParseResult<z.infer<typeof rowLoopSchema> | undefined>,
  index: number,
  errors: string[],
) {
  if (!loop.success)
    errors.push(
      t('data.pipelineActions.actionRowLoopNeedsList', {
        value: index + 1,
      }),
    )
}

export function validatePipelineActions(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public authoring boundary immediately decodes the raw list before accumulating each action's field diagnostics.
  value: unknown,
  workspaceId?: string,
): string[] {
  const list = actionListSchema.safeParse(value)
  const available = pipelineActions(workspaceId)
  const operations = new Map<string, PipelineActionDefinition>()

  for (const operation of available) {
    if (!operations.has(operation.operation))
      operations.set(operation.operation, operation)
  }

  if (!list.success) return [t('data.pipelineActions.useArrayUp20')]
  const errors: string[] = []
  const names = new Set<string>()

  for (const [index, action] of list.data.entries()) {
    const decoded = actionItemSchema.safeParse(action)

    if (!decoded.success) {
      errors.push(
        t('data.pipelineActions.actionMustObject', { value: index + 1 }),
      )
      continue
    }

    const item = decoded.data
    const name = z.string().safeParse(item.name)

    if (
      !name.success ||
      !actionName.test(name.data) ||
      ['__proto__', 'constructor', 'prototype'].includes(name.data) ||
      names.has(name.data)
    )
      errors.push(
        t('data.pipelineActions.actionNeedsUniqueName', { value: index + 1 }),
      )

    if (name.success) names.add(name.data)
    const mode = item.mode
    const operationName = z.string().safeParse(item.operation)
    const argumentsObject = actionArgumentsSchema.safeParse(item.arguments)
    const loop = rowLoopSchema.optional().safeParse(item.forEach)

    if (mode !== undefined && mode !== 'execute' && mode !== 'propose')
      errors.push(
        t('data.pipelineActions.actionHasUnknownMode', { value: index + 1 }),
      )

    // An action an extension adds is checked here only for its shape; which
    // extensions are installed, enabled and declare it is a workspace fact, so
    // the run checks that (and the declared inputs) before anything is called.
    if (operationName.success && parsePluginName(operationName.data)) {
      if (!argumentsObject.success) {
        errors.push(
          t('data.pipelineActions.actionNeedsArgumentsObject', {
            value: index + 1,
          }),
        )
        continue
      }

      if (item.mode === 'propose')
        errors.push(
          t('data.pipelineActions.actionCannotProposeHas', {
            value: index + 1,
            operation: operationName.data,
          }),
        )
      validateRowLoop(loop, index, errors)
      continue
    }

    const operation = operationName.success
      ? operations.get(operationName.data)
      : undefined

    if (!operation) {
      errors.push(
        t('data.pipelineActions.actionUsesUnsupportedOperation', {
          value: index + 1,
        }),
      )
      continue
    }

    if (!argumentsObject.success) {
      errors.push(
        t('data.pipelineActions.actionNeedsArgumentsObject', {
          value: index + 1,
        }),
      )
      continue
    }

    for (const key of Object.keys(argumentsObject.data)) {
      if (
        !operation.arguments.some(
          (entry) => entry.name === key && !entry.server,
        )
      )
        errors.push(
          t('data.pipelineActions.actionEditableArgument', {
            value: index + 1,
            key,
          }),
        )
    }

    for (const field of operation.arguments) {
      if (
        field.required &&
        !field.server &&
        !Object.hasOwn(argumentsObject.data, field.name)
      )
        errors.push(
          t('data.pipelineActions.actionRequires', {
            value: index + 1,
            name: field.name,
          }),
        )
    }

    validateRowLoop(loop, index, errors)

    if (item.mode === 'propose' && !operation.proposalKind)
      errors.push(
        t('data.pipelineActions.actionCannotProposeHas', {
          value: index + 1,
          operation: operation.operation,
        }),
      )
  }

  return errors
}
