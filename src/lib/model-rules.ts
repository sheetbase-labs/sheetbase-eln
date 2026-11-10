import { z } from 'zod'

import type { DataClient } from '#/lib/data-client'

/**
 * MDL-02 step 2 — workspace-owned model rules. The server is authoritative:
 * rules are evaluated in the canonical record write trigger and the
 * submission RPC, and read back here through the same `/api/db` boundary.
 */

export type ModelRuleEffect = 'flag_block_submit' | 'warn' | 'block'

/**
 * One side of a condition comparison: a JSON scalar, or a list of them for the
 * `in`/`not_in` operators. The stored rule DSL carries nothing else.
 */
export type ModelRuleOperand =
  string | number | boolean | null | readonly ModelRuleOperand[]

/** One custom-field value as a form holds it before the server validates it. */
export type ModelFieldValue = string | number | boolean | null | undefined

/** A model's candidate custom-field values, keyed by field name. */
export type ModelFieldValues = Record<string, ModelFieldValue>

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
  value?: ModelRuleOperand
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

const numericOperand = z.number()
const textualOperand = z.string()

/** Either side of a comparison as a stored leaf may carry it: its `value` is optional. */
type ComparisonOperand = ModelRuleOperand | undefined

function isNullish(value: ModelFieldValue): value is null | undefined | 'null' {
  return value === null || value === undefined || value === 'null'
}

function asNumber(value: ComparisonOperand): number | null {
  const numeric = numericOperand.safeParse(value)

  if (numeric.success)
    return Number.isFinite(numeric.data) ? numeric.data : null

  const textual = textualOperand.safeParse(value)

  if (!textual.success || textual.data.trim() === '') return null

  const parsed = Number(textual.data)

  return Number.isFinite(parsed) ? parsed : null
}

function looseEquals(
  left: ComparisonOperand,
  right: ComparisonOperand,
): boolean {
  const leftNumber = asNumber(left)
  const rightNumber = asNumber(right)

  if (leftNumber !== null && rightNumber !== null)
    return leftNumber === rightNumber

  return String(left) === String(right)
}

function inList(value: ComparisonOperand, list: ComparisonOperand): boolean {
  if (!Array.isArray(list)) return false

  return list.some((entry) => looseEquals(value, entry))
}

function isNotCondition(
  condition: ModelRuleCondition,
): condition is { not: ModelRuleCondition } {
  return 'not' in condition
}

function isAllCondition(
  condition: ModelRuleCondition,
): condition is { all: ModelRuleCondition[] } {
  return 'all' in condition
}

function isAnyCondition(
  condition: ModelRuleCondition,
): condition is { any: ModelRuleCondition[] } {
  return 'any' in condition
}

/**
 * The DSL's leaf predicate. `Record<string, never>` cannot be excluded by an
 * `in` check, so TypeScript cannot reach the leaf from the union on its own.
 */
function leafCondition(condition: ModelRuleCondition): ModelRuleLeafCondition {
  // SAFETY: the empty condition returned true and `not`/`all`/`any` returned above, so the only remaining non-empty shape is the leaf, whose members are then read with their own null handling.
  return condition as ModelRuleLeafCondition
}

/** Mirrors the SQL condition DSL. `{}` always matches. */
export function modelRuleConditionMatches(
  condition: ModelRuleCondition | null | undefined,
  values: ModelFieldValues,
): boolean {
  if (!condition) return true

  if (Object.keys(condition).length === 0) return true

  if (isNotCondition(condition))
    return !modelRuleConditionMatches(condition.not, values)

  if (isAllCondition(condition)) {
    return condition.all.every((entry) =>
      modelRuleConditionMatches(entry, values),
    )
  }

  if (isAnyCondition(condition)) {
    return condition.any.some((entry) =>
      modelRuleConditionMatches(entry, values),
    )
  }

  const leaf = leafCondition(condition)
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
    case 'matches': {
      const pattern = textualOperand.safeParse(leaf.value)

      return pattern.success
        ? new RegExp(pattern.data).test(String(value))
        : false
    }

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
  values: ModelFieldValues,
): ModelRecordValidation {
  const matches: ModelRuleMatch[] = []

  for (const rule of rules) {
    if (!modelRuleConditionMatches(rule.condition, values)) continue

    matches.push({
      ruleId: rule.id,
      effect: rule.effect,
      message: rule.message,
    })
  }

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
