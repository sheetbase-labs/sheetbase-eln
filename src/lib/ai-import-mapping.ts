import { z } from 'zod'

import type { ImportTargetField } from './import-mapping'

/**
 * AI help for the import map step: which file column feeds which field, and a
 * guess at each column's unit and kind of value. The model only ever sees
 * column names, a few example values and the target field list. Whatever it
 * returns is checked against that list before the person sees it: an unknown
 * field, a repeated field or a unit on a non-numeric field is dropped, so a
 * bad answer can only make the suggestion smaller, never wrong.
 */

export const AI_MAPPING_MAX_COLUMNS = 80
export const AI_MAPPING_MAX_EXAMPLES = 4

export type AiColumnKind = 'text' | 'number' | 'date' | 'yes_no' | 'choice'

export interface AiMappingColumn {
  header: string
  examples: string[]
}

export interface AiMappingSuggestion {
  header: string
  fieldId: string
  /** Unit the file already uses, only for number fields and only when seen. */
  sourceUnit: string | null
  kind: AiColumnKind | null
  reason: string
}

const answerSchema = z.object({
  columns: z.array(
    z.object({
      header: z.string(),
      field_id: z.string().nullish(),
      unit: z.string().nullish(),
      kind: z.string().nullish(),
      reason: z.string().nullish(),
    }),
  ),
})

const KINDS = new Set<string>(['text', 'number', 'date', 'yes_no', 'choice'])

function isNumeric(field: ImportTargetField): boolean {
  return field.logicalType === 'integer' || field.logicalType === 'decimal'
}

/** The instruction half of the prompt; the columns and fields follow as data. */
export function buildMappingInstruction(
  columns: AiMappingColumn[],
  fields: ImportTargetField[],
): string {
  const fieldLines = fields.map(
    (field) =>
      `- ${field.id} | ${field.label} | ${field.logicalType}${field.unit ? ` | stored in ${field.unit}` : ''}${field.nullable ? '' : ' | required'}`,
  )

  const columnLines = columns.slice(0, AI_MAPPING_MAX_COLUMNS).map(
    (column) =>
      `- ${JSON.stringify(column.header)}: ${
        column.examples.length > 0
          ? column.examples
              .slice(0, AI_MAPPING_MAX_EXAMPLES)
              .map((example) => JSON.stringify(example.slice(0, 60)))
              .join(', ')
          : '(no values)'
      }`,
  )

  return [
    'Target fields (id | label | type | unit):',
    ...fieldLines,
    '',
    'File columns (header: example values):',
    ...columnLines,
    '',
    'Reply with JSON only: {"columns":[{"header":"<exact header>","field_id":"<target id or null>","unit":"<unit the values already use or null>","kind":"text|number|date|yes_no|choice","reason":"<one short sentence>"}]}.',
    'Give one entry per file column. Each target id may be used once. Only give a unit for number fields, and only when the header or values show it.',
  ].join('\n')
}

/** Pull the first JSON object out of a model reply, fences or chatter and all. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start < 0 || end <= start) return null

  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}

/**
 * Check the model's answer against the real columns and fields. Returns only
 * suggestions that are safe to show: known header, known field, each field
 * once, a unit only where a unit means something.
 */
export function parseMappingAnswer(
  text: string,
  headers: string[],
  fields: ImportTargetField[],
): AiMappingSuggestion[] {
  const json = extractJsonObject(text)
  const parsed = answerSchema.safeParse(json)

  if (!parsed.success) return []
  const knownHeaders = new Set(headers)
  const byId = new Map(fields.map((field) => [field.id, field]))
  const usedFields = new Set<string>()
  const seenHeaders = new Set<string>()
  const out: AiMappingSuggestion[] = []

  for (const column of parsed.data.columns) {
    if (!knownHeaders.has(column.header) || seenHeaders.has(column.header))
      continue
    seenHeaders.add(column.header)
    const fieldId = column.field_id ?? ''
    const field = byId.get(fieldId)

    if (!field || usedFields.has(field.id)) continue
    usedFields.add(field.id)
    const unit = column.unit?.trim() || null
    out.push({
      header: column.header,
      fieldId: field.id,
      sourceUnit: unit && isNumeric(field) ? unit.slice(0, 40) : null,
      kind:
        column.kind && KINDS.has(column.kind)
          ? (column.kind as AiColumnKind)
          : null,
      reason: (column.reason ?? '').trim().slice(0, 200),
    })
  }

  return out
}

/** What applying the suggestions changes, given what is mapped now. */
export function changesFromSuggestions(
  suggestions: AiMappingSuggestion[],
  current: Record<string, string>,
  currentUnits: Record<string, string>,
): AiMappingSuggestion[] {
  return suggestions.filter(
    (suggestion) =>
      (current[suggestion.header] ?? '') !== suggestion.fieldId ||
      (suggestion.sourceUnit !== null &&
        (currentUnits[suggestion.header] ?? '') !== suggestion.sourceUnit),
  )
}
