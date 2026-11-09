/**
 * The operation registry: the built-in operations plus any an extension adds.
 *
 * Every integration list that used to be a frozen constant (pipeline actions,
 * assistant tool names, the agent vocabulary) is read through the functions
 * here, so an operation registered for a workspace shows up on all of them and
 * goes away when it is unregistered. The old constants stay as the built-in
 * snapshot for code that runs at module load and cannot depend on a workspace.
 */
import { AGENT_OPERATIONS } from './declarations/agent'
import { INSTRUMENT_OPERATIONS } from './declarations/instruments'
import { PEOPLE_OPERATIONS } from './declarations/people'
import { PIPELINE_OPERATIONS } from './declarations/pipeline'
import {
  assistantToolsFrom,
  operationRpc,
  pipelineActionsFrom,
} from './descriptor'
import type { OperationDescriptor } from './descriptor'
import type { PipelineActionDefinition } from '../pipelines/actions'

/** The operations that ship with Sheetbase, in declaration order. */
export const CORE_OPERATIONS: readonly OperationDescriptor[] = Object.freeze([
  ...PIPELINE_OPERATIONS,
  ...INSTRUMENT_OPERATIONS,
  ...AGENT_OPERATIONS,
  ...PEOPLE_OPERATIONS,
])

const OPERATION_NAME = /^[a-z][a-z0-9_]{0,63}$/
const TOOL_NAME = /^sheetbase\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])

/** Why a descriptor cannot be registered, or an empty list when it can. */
export function validateOperation(op: OperationDescriptor): string[] {
  const errors: string[] = []
  if (!OPERATION_NAME.test(op.name) || RESERVED.has(op.name))
    errors.push(`${op.name}: names are lower case letters, digits and _`)
  if (!op.label.trim()) errors.push(`${op.name}: a label is required`)
  if (!op.description.trim())
    errors.push(`${op.name}: a description is required`)
  if (op.assistant && !TOOL_NAME.test(op.assistant.tool))
    errors.push(`${op.name}: tool names look like sheetbase.area.verb`)
  const seen = new Set<string>()
  for (const field of op.inputs) {
    if (!/^[a-z][a-z0-9_]*$/.test(field.name) || seen.has(field.name))
      errors.push(`${op.name}: input ${field.name} is not a unique name`)
    seen.add(field.name)
  }
  if (
    op.assistant &&
    op.assistant.presentation === 'answer' &&
    op.kind === 'write'
  )
    errors.push(`${op.name}: a write cannot be answered without a card`)
  return errors
}

const registered = new Map<string, readonly OperationDescriptor[]>()
const key = (source: string, workspaceId?: string) =>
  `${workspaceId ?? '*'}\u0000${source}`

/**
 * Adds operations from a source, such as an enabled extension, for one
 * workspace (or for all of them when no workspace is given). Refuses a name
 * or tool that is already taken, so an extension can never shadow a built-in.
 * Returns a function that removes them again.
 */
export function registerOperations(
  source: string,
  operations: readonly OperationDescriptor[],
  workspaceId?: string,
): () => void {
  const taken = new Set<string>()
  const tools = new Set<string>()
  for (const op of listOperations(workspaceId)) {
    taken.add(op.name)
    if (op.assistant) tools.add(op.assistant.tool)
  }
  const errors: string[] = []
  for (const op of operations) {
    errors.push(...validateOperation(op))
    if (taken.has(op.name)) errors.push(`${op.name}: already declared`)
    if (op.assistant && tools.has(op.assistant.tool))
      errors.push(`${op.name}: tool ${op.assistant.tool} is already declared`)
    taken.add(op.name)
    if (op.assistant) tools.add(op.assistant.tool)
  }
  if (errors.length > 0) throw new Error(errors.join('; '))
  const stamped = operations.map((op) => Object.freeze({ ...op, source }))
  registered.set(key(source, workspaceId), stamped)
  return () => unregisterOperations(source, workspaceId)
}

export function unregisterOperations(
  source: string,
  workspaceId?: string,
): void {
  registered.delete(key(source, workspaceId))
}

/** The built-in operations plus those registered for this workspace. */
export function listOperations(workspaceId?: string): OperationDescriptor[] {
  const extra: OperationDescriptor[] = []
  for (const [k, ops] of registered) {
    const scope = k.slice(0, k.indexOf('\u0000'))
    if (scope === '*' || scope === workspaceId) extra.push(...ops)
  }
  return [...CORE_OPERATIONS, ...extra]
}

export function findOperation(
  name: string,
  workspaceId?: string,
): OperationDescriptor | undefined {
  return listOperations(workspaceId).find((op) => op.name === name)
}

/** Pipeline actions: built-in plus this workspace's extension actions. */
export function pipelineActions(
  workspaceId?: string,
): PipelineActionDefinition[] {
  return pipelineActionsFrom(listOperations(workspaceId))
}

export function assistantProposeToolNames(workspaceId?: string): string[] {
  return assistantToolsFrom(listOperations(workspaceId), 'propose')
}

export function assistantReadToolNames(workspaceId?: string): string[] {
  return assistantToolsFrom(listOperations(workspaceId), 'read')
}

export function agentOperationToolNames(workspaceId?: string): string[] {
  return assistantToolsFrom(listOperations(workspaceId), 'operation')
}

export { operationRpc }
