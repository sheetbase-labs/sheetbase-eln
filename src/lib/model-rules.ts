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
  const filter = modelKey
    ? `?model_key=eq.${encodeURIComponent(modelKey)}&`
    : '?'
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

// ---------------------------------------------------------------------------
// MDL-04.2 — a client mirror of `internal.model_rule_condition_matches` /
// `internal.evaluate_model_rules`, used to show rules inline on a generated
// form before the server has seen the values. The server stays authoritative:
// this never decides what is saved, only what the form says in advance.
// ---------------------------------------------------------------------------

function isNullish(value: unknown): boolean {
  return value === null || value === undefined || value === 'null'
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function looseEquals(left: unknown, right: unknown): boolean {
  const leftNumber = asNumber(left)
  const rightNumber = asNumber(right)
  if (leftNumber !== null && rightNumber !== null)
    return leftNumber === rightNumber
  return String(left) === String(right)
}

function inList(value: unknown, list: unknown): boolean {
  if (!Array.isArray(list)) return false
  return list.some((entry) => looseEquals(value, entry))
}

/** Mirrors the SQL condition DSL. `{}` always matches. */
export function modelRuleConditionMatches(
  condition: ModelRuleCondition | null | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!condition) return true
  if (Object.keys(condition).length === 0) return true
  if ('not' in condition)
    return !modelRuleConditionMatches(
      (condition as { not: ModelRuleCondition }).not,
      values,
    )
  if ('all' in condition) {
    const all = (condition as { all: ModelRuleCondition[] }).all
    return all.every((entry) => modelRuleConditionMatches(entry, values))
  }
  if ('any' in condition) {
    const any = (condition as { any: ModelRuleCondition[] }).any
    return any.some((entry) => modelRuleConditionMatches(entry, values))
  }

  const leaf = condition as ModelRuleLeafCondition
  const op = leaf.op ?? 'eq'
  const value = values[leaf.field]
  if (op === 'is_null') return isNullish(value)
  if (op === 'not_null') return !isNullish(value)
  if (isNullish(value)) return false
  switch (op) {
    case 'eq':
      return looseEquals(value, leaf.value)
    case 'neq':
      return !looseEquals(value, leaf.value)
    case 'in':
      return inList(value, leaf.value)
    case 'not_in':
      return !inList(value, leaf.value)
    case 'matches':
      return typeof leaf.value === 'string'
        ? new RegExp(leaf.value).test(String(value))
        : false
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = asNumber(value)
      const right = asNumber(leaf.value)
      if (left !== null && right !== null) {
        return op === 'gt'
          ? left > right
          : op === 'gte'
            ? left >= right
            : op === 'lt'
              ? left < right
              : left <= right
      }
      const a = String(value)
      const b = String(leaf.value)
      return op === 'gt'
        ? a > b
        : op === 'gte'
          ? a >= b
          : op === 'lt'
            ? a < b
            : a <= b
    }
    default:
      return false
  }
}

/** Evaluate a model's rules against candidate custom-field values. */
export function evaluateModelRules(
  rules: ModelRule[],
  values: Record<string, unknown>,
): ModelRecordValidation {
  const matches = rules
    .filter((rule) => modelRuleConditionMatches(rule.condition, values))
    .map<ModelRuleMatch>((rule) => ({
      ruleId: rule.id,
      effect: rule.effect,
      message: rule.message,
    }))
  const byEffect = (effect: ModelRuleEffect) =>
    matches.filter((match) => match.effect === effect)
  return {
    blocked: byEffect('block').length > 0,
    blockSubmit: matches.some(
      (match) =>
        match.effect === 'block' || match.effect === 'flag_block_submit',
    ),
    warnings: byEffect('warn'),
    blocks: byEffect('block'),
    submitBlocks: byEffect('flag_block_submit'),
  }
}
