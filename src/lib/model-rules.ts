import type { DataClient } from '#/lib/data-client'

/**
 * MDL-02 step 2 — workspace-owned model rules. The server is authoritative:
 * rules are evaluated in the canonical record write trigger and the
 * submission RPC, and read back here through the same `/api/db` boundary.
 */

export type ModelRuleEffect = 'flag_block_submit' | 'warn' | 'block'

/** Leaf predicate over a model custom field. */
export interface ModelRuleLeafCondition {
  field: string
  op?:
    | 'eq'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'in'
    | 'not_in'
    | 'is_null'
    | 'not_null'
    | 'matches'
  value?: unknown
}

/** Boolean combinator or leaf. `{}` always matches. */
export type ModelRuleCondition =
  | Record<string, never>
  | ModelRuleLeafCondition
  | { all: ModelRuleCondition[] }
  | { any: ModelRuleCondition[] }
  | { not: ModelRuleCondition }

export interface ModelRule {
  id: string
  workspaceId: string
  modelKey: string
  name: string
  /** "Applies to" fields. The condition is authoritative. */
  fieldKeys: string[]
  condition: ModelRuleCondition
  effect: ModelRuleEffect
  message: string
  createdAt: string
  updatedAt: string
}

export interface ModelRuleMatch {
  ruleId: string
  effect: ModelRuleEffect
  message: string
}

export interface ModelRecordValidation {
  blocked: boolean
  blockSubmit: boolean
  warnings: ModelRuleMatch[]
  blocks: ModelRuleMatch[]
  submitBlocks: ModelRuleMatch[]
}

interface ModelRuleWire {
  id: string
  workspace_id: string
  model_key: string
  name: string
  field_keys: string[]
  condition: ModelRuleCondition
  effect: ModelRuleEffect
  message: string
  created_at: string
  updated_at: string
}

function fromWire(row: ModelRuleWire): ModelRule {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    modelKey: row.model_key,
    name: row.name,
    fieldKeys: row.field_keys,
    condition: row.condition,
    effect: row.effect,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function fetchModelRules(
  client: DataClient,
  modelKey?: string,
): Promise<ModelRule[]> {
  const filter = modelKey ? `?model_key=eq.${encodeURIComponent(modelKey)}&` : '?'
  const rows = await client.list<ModelRuleWire>(
    'model_rules',
    `${filter}order=model_key.asc,created_at.asc,id.asc`,
  )
  return rows.map(fromWire)
}

export interface CreateModelRuleInput {
  workspaceId: string
  modelKey: string
  name: string
  fieldKeys: string[]
  condition: ModelRuleCondition
  effect: ModelRuleEffect
  message: string
}

export async function createModelRule(
  client: DataClient,
  input: CreateModelRuleInput,
): Promise<ModelRule> {
  const row = await client.rpc<ModelRuleWire>('create_model_rule', {
    p_workspace_id: input.workspaceId,
    p_model_key: input.modelKey,
    p_name: input.name,
    p_field_keys: input.fieldKeys,
    p_condition: input.condition,
    p_effect: input.effect,
    p_message: input.message,
  })
  return fromWire(row)
}

export interface UpdateModelRulePatch {
  name?: string
  fieldKeys?: string[]
  condition?: ModelRuleCondition
  effect?: ModelRuleEffect
  message?: string
}

export async function updateModelRule(
  client: DataClient,
  ruleId: string,
  patch: UpdateModelRulePatch,
): Promise<ModelRule> {
  const row = await client.rpc<ModelRuleWire>('update_model_rule', {
    p_rule_id: ruleId,
    p_patch: patch,
  })
  return fromWire(row)
}

export function removeModelRule(
  client: DataClient,
  ruleId: string,
): Promise<void> {
  return client.rpc<void>('remove_model_rule', { p_rule_id: ruleId })
}

/** The same rule engine the write and submit paths use, for display. */
export function fetchModelRecordValidation(
  client: DataClient,
  recordId: string,
): Promise<ModelRecordValidation> {
  return client.rpc<ModelRecordValidation>('model_record_validation', {
    p_record_id: recordId,
  })
}
