/**
 * Before someone signs: a plain summary of what changed and a short list of
 * things worth a second look. Everything here is advisory. It reads the frozen
 * revision the signature would attach to, never blocks a signature, and never
 * changes anything. The model, when the workspace has one on, only rephrases
 * the facts built here; the facts are always shown.
 */
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

type Rec = Record<string, unknown>

/** Older envelopes can lack a collection altogether. */
function list<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : []
}

function asRec(value: unknown): Rec | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Rec)
    : null
}

function isEmptyCell(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function sheetLabel(
  envelope: CanonicalRevisionEnvelope,
  blockId: string,
  index: number,
): string {
  const block = list(envelope.blocks).find((item) => item.id === blockId)
  const payload = asRec(block?.payload)
  const title = payload?.title ?? payload?.name ?? payload?.label

  return typeof title === 'string' && title.trim()
    ? title.trim()
    : `Sheet ${index + 1}`
}

function fieldLabel(field: Rec): string {
  if (typeof field.label === 'string' && field.label.trim()) return field.label

  if (typeof field.key === 'string' && field.key.trim()) return field.key

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
      const fieldId = field.fieldId

      if (typeof fieldId !== 'string') continue

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
          const unit = asRec(field.quantity)?.storageUnit
          const suffix = typeof unit === 'string' ? ` ${unit}` : ''
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

    const where =
      typeof table.display_name === 'string' && table.display_name.trim()
        ? table.display_name
        : 'Table'

    for (const column of columns) {
      if (typeof column.api_name !== 'string') continue
      const unit = column.unit

      if (typeof unit === 'string' && unit.trim()) continue

      const numbers = rows.filter(
        (row) => asNumber(row[column.api_name as string]) !== null,
      ).length

      // A column of plain labels or identifiers is not a missing unit: only
      // flag a column where most of what is there is a number.
      const filled = rows.filter(
        (row) => !isEmptyCell(row[column.api_name as string]),
      ).length

      if (numbers > 0 && numbers === filled) {
        warnings.push({
          id: `unit:${String(table.id)}:${String(column.id)}`,
          kind: 'missing-unit',
          where,
          field:
            typeof column.display_name === 'string' && column.display_name
              ? column.display_name
              : column.api_name,
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
