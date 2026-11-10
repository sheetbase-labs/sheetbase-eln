/**
 * Before someone signs: a plain summary of what changed and a short list of
 * things worth a second look. Everything here is advisory. It reads the frozen
 * revision the signature would attach to, never blocks a signature, and never
 * changes anything. The model, when the workspace has one on, only rephrases
 * the facts built here; the facts are always shown.
 */
import { z } from 'zod'

import type {
  CanonicalRevisionEnvelope,
  RevisionChangeArea,
  RevisionDiffResult,
} from './revision-diff'

export type PreSignWarningKind =
  'missing-unit' | 'out-of-spec' | 'empty-required'

export interface PreSignWarning {
  id: string
  kind: PreSignWarningKind
  /** The table or sheet the warning is about. */
  where: string
  /** The column or field. */
  field: string
  /** How many cells or rows are affected. */
  count: number
  /** The limit that was crossed, for out-of-spec values. */
  limit?: string
}

export interface PreSignChangeLine {
  area: RevisionChangeArea | 'first'
  count: number
}

export interface PreSignReview {
  /** One line per area that changed, or the contents of a first version. */
  changes: PreSignChangeLine[]
  warnings: PreSignWarning[]
  /** True when there is something to compare against. */
  compared: boolean
}

/** One stored JSON object from a frozen revision: a payload, a state, a validation. */
const recordSchema = z.record(z.string(), z.unknown())

type Rec = z.infer<typeof recordSchema>

/** Older envelopes can lack a collection altogether. */
function list<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : []
}

/** A stored JSON object, or null when the value is anything else. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A frozen revision stores these as JSON; this is where an object is decoded from it.
function asRec(value: unknown): Rec | null {
  return recordSchema.safeParse(value).data ?? null
}

/** A cell with nothing in it: absent, blank text or an empty list. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A frozen cell is stored JSON; its blank and empty-list forms are tested here.
function isEmptyCell(value: unknown): boolean {
  if (value === null || value === undefined) return true

  return (
    z.string().trim().max(0).safeParse(value).success ||
    z.array(z.unknown()).max(0).safeParse(value).success
  )
}

/** A stored number, or a number written as text; null for anything else. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A frozen cell is stored JSON; a number or numeric text is read from it here.
function asNumber(value: unknown): number | null {
  const stored = z.number().finite().safeParse(value).data

  if (stored !== undefined) return stored
  const text = z.string().trim().min(1).safeParse(value).data

  if (text === undefined) return null
  const parsed = Number(text)

  return Number.isFinite(parsed) ? parsed : null
}

function sheetLabel(
  envelope: CanonicalRevisionEnvelope,
  blockId: string,
  index: number,
): string {
  const block = list(envelope.blocks).find((item) => item.id === blockId)
  const payload = asRec(block?.payload)
  const stored = payload?.title ?? payload?.name ?? payload?.label
  const title = z.string().safeParse(stored).data

  return title?.trim() ? title : `Sheet ${index + 1}`
}

function fieldLabel(field: Rec): string {
  const label = z.string().safeParse(field.label).data

  if (label?.trim()) return label
  const key = z.string().safeParse(field.key).data

  if (key?.trim()) return key

  return 'Column'
}

/** Warnings from a frozen sheet: empty required cells and out-of-range values. */
function sheetWarnings(envelope: CanonicalRevisionEnvelope): PreSignWarning[] {
  const warnings: PreSignWarning[] = []
  list(envelope.sheetEvidence).forEach((sheet, index) => {
    const state = asRec(sheet.instanceState) ?? {}

    const fields = Array.isArray(state.localFields)
      ? state.localFields.map(asRec).filter((f): f is Rec => f !== null)
      : []

    const values = asRec(state.localValues) ?? {}
    const rows = Object.values(values).map((row) => asRec(row) ?? {})

    if (rows.length === 0) return
    const where = sheetLabel(envelope, sheet.blockId, index)

    for (const field of fields) {
      const fieldId = z.string().safeParse(field.fieldId).data

      if (fieldId === undefined) continue

      if (field.lifecycle === 'retired' || field.lifecycle === 'draft') continue
      const computed = asRec(field.computation)?.mode === 'computed'
      const name = fieldLabel(field)

      if (field.nullable === false && !computed) {
        const empty = rows.filter((row) => isEmptyCell(row[fieldId])).length

        if (empty > 0) {
          warnings.push({
            id: `empty:${sheet.blockId}:${fieldId}`,
            kind: 'empty-required',
            where,
            field: name,
            count: empty,
          })
        }
      }

      const validation = asRec(field.validation) ?? {}
      const min = asNumber(validation.min)
      const max = asNumber(validation.max)

      if (min !== null || max !== null) {
        const out = rows.filter((row) => {
          const n = asNumber(row[fieldId])

          return (
            n !== null &&
            ((min !== null && n < min) || (max !== null && n > max))
          )
        }).length

        if (out > 0) {
          const storedUnit = asRec(field.quantity)?.storageUnit
          const unit = z.string().safeParse(storedUnit).data
          const suffix = unit === undefined ? '' : ` ${unit}`
          warnings.push({
            id: `spec:${sheet.blockId}:${fieldId}`,
            kind: 'out-of-spec',
            where,
            field: name,
            count: out,
            limit:
              min !== null && max !== null
                ? `${min}–${max}${suffix}`
                : min !== null
                  ? `≥ ${min}${suffix}`
                  : `≤ ${max}${suffix}`,
          })
        }
      }

      const numeric =
        field.logicalType === 'decimal' || field.logicalType === 'integer'

      if (
        numeric &&
        !computed &&
        !asRec(field.quantity) &&
        rows.some((row) => asNumber(row[fieldId]) !== null)
      ) {
        warnings.push({
          id: `unit:${sheet.blockId}:${fieldId}`,
          kind: 'missing-unit',
          where,
          field: name,
          count: rows.filter((row) => asNumber(row[fieldId]) !== null).length,
        })
      }
    }
  })

  return warnings
}

/** Warnings from the record's scientific tables: numbers in a column with no unit. */
function tableWarnings(envelope: CanonicalRevisionEnvelope): PreSignWarning[] {
  const warnings: PreSignWarning[] = []

  for (const table of list(envelope.scientificTables)) {
    const columns = Array.isArray(table.columns)
      ? table.columns.map(asRec).filter((c): c is Rec => c !== null)
      : []

    const rows = Array.isArray(table.rows)
      ? table.rows.map(asRec).filter((r): r is Rec => r !== null)
      : []

    const displayName = z.string().safeParse(table.display_name).data
    const where = displayName?.trim() ? displayName : 'Table'

    for (const column of columns) {
      const apiName = z.string().safeParse(column.api_name).data

      if (apiName === undefined) continue
      const unit = z.string().safeParse(column.unit).data

      if (unit?.trim()) continue

      const numbers = rows.filter(
        (row) => asNumber(row[apiName]) !== null,
      ).length

      // A column of plain labels or identifiers is not a missing unit: only
      // flag a column where most of what is there is a number.
      const filled = rows.filter((row) => !isEmptyCell(row[apiName])).length

      if (numbers > 0 && numbers === filled) {
        warnings.push({
          id: `unit:${String(table.id)}:${String(column.id)}`,
          kind: 'missing-unit',
          where,
          field: z.string().safeParse(column.display_name).data || apiName,
          count: numbers,
        })
      }
    }
  }

  return warnings
}

const KIND_ORDER: Record<PreSignWarningKind, number> = {
  'out-of-spec': 0,
  'empty-required': 1,
  'missing-unit': 2,
}

/**
 * Build the review for one frozen revision. `diff` is the comparison with the
 * earlier version the reviewer chose; without one, the contents of the first
 * version are counted instead.
 */
export function buildPreSignReview(
  revision: CanonicalRevisionEnvelope,
  diff: RevisionDiffResult | null,
): PreSignReview {
  const warnings = [
    ...sheetWarnings(revision),
    ...tableWarnings(revision),
  ].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])

  const changes: PreSignChangeLine[] = []

  if (diff) {
    const byArea = new Map<RevisionChangeArea, number>()

    for (const change of diff.changes) {
      byArea.set(change.area, (byArea.get(change.area) ?? 0) + 1)
    }

    for (const [area, count] of byArea) changes.push({ area, count })
    changes.sort((a, b) => a.area.localeCompare(b.area))
  } else {
    const parts: Array<[RevisionChangeArea, number]> = [
      ['blocks', list(revision.blocks).length],
      [
        'tables',
        list(revision.scientificTables).length +
          list(revision.sheetEvidence).length,
      ],
      ['files', list(revision.files).length],
      ['links', list(revision.links).length],
    ]

    for (const [area, count] of parts) {
      if (count > 0) changes.push({ area, count })
    }
  }

  return { changes, warnings, compared: diff !== null }
}

/**
 * A compact, citable description of the review, handed to the model so it can
 * phrase the summary. Only counts, labels and limits; no record text, so the
 * prompt carries what the signer is about to see and nothing more.
 */
export function preSignFacts(
  review: PreSignReview,
  diff: RevisionDiffResult | null,
): string {
  const lines: string[] = []

  if (review.compared && diff) {
    lines.push(
      `Changes since the earlier version: ${diff.counts.added} added, ${diff.counts.removed} removed, ${diff.counts.modified} edited, ${diff.counts.moved} moved.`,
    )

    for (const change of diff.changes.slice(0, 40)) {
      lines.push(`- ${change.kind} ${change.area}: ${change.label}`)
    }
  } else {
    lines.push('This is the first submitted version.')

    for (const line of review.changes)
      lines.push(`- ${line.count} ${line.area}`)
  }

  for (const warning of review.warnings) {
    lines.push(
      `Check (${warning.kind}): ${warning.where} / ${warning.field}, ${warning.count} value(s)${warning.limit ? `, limit ${warning.limit}` : ''}.`,
    )
  }

  return lines.join('\n')
}
