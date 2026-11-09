import { t } from '#/copy'
import { pipelineActionsFrom } from '#/lib/operations/descriptor'
import { CORE_OPERATIONS, pipelineActions } from '#/lib/operations/registry'
import { parsePluginName } from '#/lib/extensions/points'
/** Browser-safe catalogue of governed ELN operations available to pipeline actions. */
export interface PipelineAction {
  name: string
  operation: string
  arguments: Record<string, unknown>
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

/** The most rows one action may run for. A larger import is split into several runs. */
export const PIPELINE_ACTION_ROW_LIMIT = 500

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
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'jsonb'
  | 'text[]'
export interface PipelineActionArgument {
  name: string
  type: PipelineActionArgumentType
  required: boolean
  nullable?: boolean
  server?: 'idempotency'
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
function validateRowLoop(forEach: unknown, index: number, errors: string[]) {
  if (forEach === undefined) return
  const reference =
    forEach !== null &&
    typeof forEach === 'object' &&
    !Array.isArray(forEach) &&
    Object.keys(forEach).length === 1
      ? (forEach as { $ref?: unknown }).$ref
      : undefined
  const parts = typeof reference === 'string' ? reference.split('.') : []
  if (
    parts.length === 0 ||
    !PIPELINE_ACTION_ROW_SOURCES.includes(parts[0]) ||
    parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
  )
    errors.push(
      t('data.pipelineActions.actionRowLoopNeedsList', {
        value: index + 1,
      }),
    )
}
export function validatePipelineActions(
  value: unknown,
  workspaceId?: string,
): string[] {
  const available = pipelineActions(workspaceId)
  if (!Array.isArray(value) || value.length > 20)
    return [t('data.pipelineActions.useArrayUp20')]
  const errors: string[] = []
  const names = new Set<string>()
  for (const [index, action] of value.entries()) {
    if (!action || typeof action !== 'object') {
      errors.push(
        t('data.pipelineActions.actionMustObject', { value: index + 1 }),
      )
      continue
    }
    const item = action as Partial<PipelineAction>
    if (
      typeof item.name !== 'string' ||
      !actionName.test(item.name) ||
      ['__proto__', 'constructor', 'prototype'].includes(item.name) ||
      names.has(item.name)
    )
      errors.push(
        t('data.pipelineActions.actionNeedsUniqueName', { value: index + 1 }),
      )
    if (typeof item.name === 'string') names.add(item.name)
    // The item is unvalidated JSON: check the raw mode before narrowing it.
    const mode: unknown = item.mode
    if (mode !== undefined && mode !== 'execute' && mode !== 'propose')
      errors.push(
        t('data.pipelineActions.actionHasUnknownMode', { value: index + 1 }),
      )
    // An action an extension adds is checked here only for its shape; which
    // extensions are installed, enabled and declare it is a workspace fact, so
    // the run checks that (and the declared inputs) before anything is called.
    if (typeof item.operation === 'string' && parsePluginName(item.operation)) {
      if (
        !item.arguments ||
        typeof item.arguments !== 'object' ||
        Array.isArray(item.arguments)
      ) {
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
            operation: item.operation,
          }),
        )
      validateRowLoop(item.forEach, index, errors)
      continue
    }
    const operation = available.find(
      (entry) => entry.operation === item.operation,
    )
    if (!operation) {
      errors.push(
        t('data.pipelineActions.actionUsesUnsupportedOperation', {
          value: index + 1,
        }),
      )
      continue
    }
    if (
      !item.arguments ||
      typeof item.arguments !== 'object' ||
      Array.isArray(item.arguments)
    ) {
      errors.push(
        t('data.pipelineActions.actionNeedsArgumentsObject', {
          value: index + 1,
        }),
      )
      continue
    }
    for (const key of Object.keys(item.arguments)) {
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
        !Object.hasOwn(item.arguments, field.name)
      )
        errors.push(
          t('data.pipelineActions.actionRequires', {
            value: index + 1,
            name: field.name,
          }),
        )
    }
    validateRowLoop(item.forEach, index, errors)
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
