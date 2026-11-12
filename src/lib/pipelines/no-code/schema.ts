import { z } from 'zod'

import { t } from '#/copy'
import {
  CONDITION_OPERATORS,
  FORMULA_OPERATORS,
  MAX_CONDITIONS,
  MAX_RANGES,
  MAX_TERMS,
} from './forms'
import type { NoCodeForm, NoCodeKind } from './forms'
import { noCodeStatement } from './generate'

type JsonValue = z.core.util.JSONType

const condition = z.object({
  column: z.string(),
  op: z.enum(CONDITION_OPERATORS),
  value: z.string().optional(),
  text: z.boolean().optional(),
})

const match = z.enum(['all', 'any'])

const schemas = {
  filter: z.object({
    match,
    conditions: z.array(condition).max(MAX_CONDITIONS),
  }),
  join: z.object({
    with: z.string(),
    type: z.enum(['inner', 'left']),
    keys: z.array(z.object({ left: z.string(), right: z.string() })).max(10),
    bring: z.array(z.string()).max(100),
  }),
  calculate: z.object({
    column: z.string(),
    terms: z
      .array(
        z.object({
          op: z.enum(FORMULA_OPERATORS).optional(),
          column: z.string().optional(),
          number: z.number().optional(),
        }),
      )
      .max(MAX_TERMS),
    places: z.number().int().nullable(),
    unit: z.string().max(16).optional(),
  }),
  check_ranges: z.object({
    ranges: z
      .array(
        z.object({
          column: z.string(),
          min: z.number().optional(),
          max: z.number().optional(),
        }),
      )
      .max(MAX_RANGES),
    keep: z.enum(['all', 'outside']),
  }),
  flag: z.object({
    column: z.string(),
    match,
    conditions: z.array(condition).max(MAX_CONDITIONS),
  }),
} satisfies Record<NoCodeKind, z.ZodType>

/** The form a stored step holds, or null when it is not a form of that kind. */
export function parseNoCodeForm(
  kind: NoCodeKind,
  value: JsonValue,
): NoCodeForm | null {
  const parsed = schemas[kind].safeParse(value)

  return parsed.success ? parsed.data : null
}

/**
 * Why a stored no-code step is not usable: its form is not one, or the SQL it
 * carries is not the SQL its form writes. Null when it is fine.
 */
export function noCodeStepProblem(
  kind: NoCodeKind,
  form: JsonValue,
  statement: JsonValue,
): { field: 'form' | 'statement'; message: string } | null {
  const parsed = parseNoCodeForm(kind, form)

  if (!parsed) return { field: 'form', message: t('data.noCode.formInvalid') }
  const made = noCodeStatement(kind, parsed)

  if (!made.ok) return { field: 'form', message: made.reason }

  if (z.string().safeParse(statement).data?.trim() !== made.statement)
    return { field: 'statement', message: t('data.noCode.sqlMismatch') }

  return null
}
