import { operatorsForField } from '@sheetbase-labs/sheetbase-shared'
import type {
  ConditionNode,
  FilterOperator,
  GroupNode,
  SheetbaseField,
} from '@sheetbase-labs/sheetbase-shared'
import { z } from 'zod'

import { extractJsonObject } from './ai-import-mapping'

/**
 * Plain-English search: a sentence becomes the same filter tree the rule
 * builder edits. The model is given the fields the builder offers and must
 * answer in those terms; whatever does not check out against the real fields,
 * their operators and their options is dropped (and reported) rather than
 * guessed at, so the person always lands in the builder with filters they can
 * read and change.
 */

export const AI_SEARCH_MAX_FIELDS = 150
const MAX_CONDITIONS = 12

const answerSchema = z.object({
  text: z.string().nullish(),
  match: z.enum(['all', 'any']).nullish(),
  filters: z
    .array(
      z.object({
        field: z.string(),
        operator: z.string(),
        value: z.unknown().optional(),
      }),
    )
    .default([]),
})

function describeField(field: SheetbaseField): string {
  const ops = operatorsForField(field).join(',')

  const options =
    field.options && field.options.length > 0 && field.options.length <= 12
      ? ` | choices: ${field.options.join(', ')}`
      : ''

  return `- ${field.id} | ${field.label} | ${field.dataType} | operators: ${ops}${options}`
}

export function searchInstruction(
  question: string,
  fields: readonly SheetbaseField[],
  today: string,
): string {
  return [
    `Today is ${today}.`,
    `Search question: ${JSON.stringify(question.trim())}`,
    'Fields you may filter on (id | label | type | operators):',
    ...fields.slice(0, AI_SEARCH_MAX_FIELDS).map(describeField),
    '',
    'Reply with JSON only: {"text":"<words to search for, or empty>","match":"all|any","filters":[{"field":"<field id>","operator":"<operator>","value":<value>}]}.',
    'Values: text for text and choice fields (use the label a person would type, e.g. a project name), a number for number fields, true or false for yes/no fields, an ISO date (YYYY-MM-DD) for dates, [from,to] for between, a list for in, a number of days for withinLastDays. Leave value out for isNull and notNull.',
    'Put words that are not a filter (what the person is looking for) in "text". Use "any" only when the question says "or".',
  ].join('\n')
}

export interface AiSearchProposal {
  /** Words left for the full-text search. */
  q: string
  /** The filters, or null when none survived. */
  filter: GroupNode | null
  /** Plain descriptions of the parts that could not be turned into a filter. */
  skipped: string[]
}

let counter = 0

function nodeId(): string {
  counter += 1

  return `ai_${counter}`
}

function coerceScalar(field: SheetbaseField, value: unknown): unknown {
  if (field.dataType === 'number') {
    const n = typeof value === 'number' ? value : Number(value)

    return Number.isFinite(n) ? n : undefined
  }

  if (field.dataType === 'boolean') {
    if (typeof value === 'boolean') return value

    if (value === 'true') return true

    if (value === 'false') return false

    return undefined
  }

  if (field.dataType === 'date' || field.dataType === 'datetime') {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
      ? value
      : undefined
  }

  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined
}

/** A typed name (`AAV8 TFF`) stands for the option the field would store. */
async function resolveOption(
  field: SheetbaseField,
  value: unknown,
): Promise<unknown> {
  if (typeof value !== 'string') return undefined

  if (field.options && field.options.length > 0) {
    const wanted = value.trim().toLowerCase()

    return field.options.find((option) => option.toLowerCase() === wanted)
  }

  if (!field.loadOptions) return value
  const options = await field.loadOptions(value).catch(() => [])
  const wanted = value.trim().toLowerCase()

  const exact =
    options.find((option) => option.value === value) ??
    options.find((option) => option.label.toLowerCase() === wanted)

  if (exact) return exact.value

  return options.length === 1 ? options[0].value : undefined
}

async function buildCondition(
  field: SheetbaseField,
  operator: FilterOperator,
  raw: unknown,
): Promise<ConditionNode | null> {
  const base = { type: 'condition' as const, id: nodeId(), field: field.id }

  if (operator === 'isNull' || operator === 'notNull')
    return { ...base, operator }

  const hasChoices = Boolean(
    (field.options && field.options.length > 0) || field.loadOptions,
  )

  const one = async (value: unknown) =>
    hasChoices ? await resolveOption(field, value) : coerceScalar(field, value)

  if (operator === 'withinLastDays') {
    const days = Number(raw)

    return Number.isFinite(days) && days > 0
      ? { ...base, operator, value: Math.round(days) }
      : null
  }

  if (operator === 'between') {
    if (!Array.isArray(raw) || raw.length !== 2) return null
    const pair = [coerceScalar(field, raw[0]), coerceScalar(field, raw[1])]

    return pair.every((v) => v !== undefined)
      ? { ...base, operator, value: pair }
      : null
  }

  if (operator === 'in') {
    const list = Array.isArray(raw) ? raw : [raw]

    const values = (await Promise.all(list.map(one))).filter(
      (v) => v !== undefined,
    )

    return values.length === list.length && values.length > 0
      ? { ...base, operator, value: values }
      : null
  }

  const value = await one(raw)

  return value === undefined ? null : { ...base, operator, value }
}

/** Turn the model's answer into a filter tree, keeping only what checks out. */
export async function parseSearchAnswer(
  text: string,
  fields: readonly SheetbaseField[],
): Promise<AiSearchProposal | null> {
  const parsed = answerSchema.safeParse(extractJsonObject(text))

  if (!parsed.success) return null
  const byId = new Map(fields.map((field) => [field.id, field]))
  const conditions: ConditionNode[] = []
  const skipped: string[] = []

  for (const filter of parsed.data.filters.slice(0, MAX_CONDITIONS)) {
    const field = byId.get(filter.field)

    const label = `${field?.label ?? filter.field} ${filter.operator} ${
      filter.value === undefined ? '' : JSON.stringify(filter.value)
    }`.trim()

    if (!field) {
      skipped.push(label)
      continue
    }

    const allowed = operatorsForField(field) as readonly string[]

    if (!allowed.includes(filter.operator)) {
      skipped.push(label)
      continue
    }

    const condition = await buildCondition(
      field,
      filter.operator as FilterOperator,
      filter.value,
    )

    if (condition) conditions.push(condition)
    else skipped.push(label)
  }

  const match = parsed.data.match === 'any' ? 'OR' : 'AND'

  return {
    q: (parsed.data.text ?? '').trim(),
    filter:
      conditions.length > 0
        ? {
            type: 'group',
            id: nodeId(),
            combinator: match,
            children: conditions,
          }
        : null,
    skipped,
  }
}
