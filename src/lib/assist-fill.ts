/**
 * Fill a form from text. The person pastes a supplier sheet, a certificate or
 * a label, or picks a PDF; the model reads it and proposes values for the
 * fields on the form. The pure parts live here: how the request is worded,
 * and how the answer is checked before it touches the form. The values only
 * ever land in the form's own inputs, so the person reviews and saves them as
 * if they had typed them.
 */
import { z } from 'zod'

import { PAGE_AI_MAX_TEXT_CHARS } from './page-ai'

export interface FillField {
  key: string
  label: string
  /** What the field holds, in a few words: "date as YYYY-MM-DD". */
  hint?: string
}

export const FILL_PDF_MAX_BYTES = 6 * 1024 * 1024

export const FILL_INSTRUCTION =
  'Read the source and give a value for each listed field that the source states. Reply with one JSON object only, whose keys are the field keys and whose values are strings. Leave out any field the source does not state. Never guess or invent a value.'

/** The model's answer as it is read: one proposed value per known field key. */
export interface FillValues {
  [fieldKey: string]: string
}

/** A model answer is one JSON object; each member is judged on its own below. */
const fillAnswerSchema = z.record(z.string(), z.unknown())

/** Only text and numbers can land in a form field. */
const fillScalarSchema = z.union([z.string(), z.number()])

/** The text sent to the model: the fields, then as much of the source as fits. */
export function buildFillText(
  fields: readonly FillField[],
  source: string,
): string {
  const list = fields
    .map(
      (field) =>
        `- ${field.key}: ${field.label}${field.hint ? ` (${field.hint})` : ''}`,
    )
    .join('\n')

  const head = `Fields:\n${list}\n\nSource:\n`
  const room = Math.max(0, PAGE_AI_MAX_TEXT_CHARS - head.length)

  return head + source.trim().slice(0, room)
}

/**
 * Read the model's answer. Anything that is not a known field, not a string
 * or number, or empty is dropped; long values are cut off, because nothing in
 * a form field should be a paragraph.
 */
export function parseFillResponse(
  answer: string,
  fields: readonly FillField[],
): FillValues {
  const start = answer.indexOf('{')
  const end = answer.lastIndexOf('}')

  if (start === -1 || end <= start) return {}
  let decoded: unknown

  try {
    decoded = JSON.parse(answer.slice(start, end + 1))
  } catch {
    return {}
  }

  const parsed = fillAnswerSchema.safeParse(decoded)

  if (!parsed.success) return {}
  const known = new Set(fields.map((field) => field.key))
  const values: FillValues = {}

  for (const [key, raw] of Object.entries(parsed.data)) {
    if (!known.has(key)) continue

    const scalar = fillScalarSchema.safeParse(raw)

    if (!scalar.success) continue
    const value = String(scalar.data).trim()

    if (value === '' || value.length > 500) continue
    values[key] = value
  }

  return values
}

/** Dates are filled only when they are already in the form's own format. */
export function onlyIsoDate(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}
