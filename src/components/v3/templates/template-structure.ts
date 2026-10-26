import type { FieldChange } from '#/components/v3/models/record-model-fields'
import type { NotebookTemplatePlacement } from '#/lib/notebook-template'
import type { SheetDefinitionVersion } from '#/lib/sheet-definition-data'

/** Sheet definition versions a template's placements pin, by version id. */
export type SheetVersionLookup = ReadonlyMap<string, SheetDefinitionVersion>

/** One row of the Sections editor's column table. */
export interface SheetColumnRow {
  id: string
  label: string
  /** "Material lot", "Typed in sheet" or "ƒx". */
  source: string
  calculated: boolean
  /** "Text", "Number", "Record link". */
  type: string
  unit: string | null
  required: boolean
  /** The rule column: a range, a limit, a note, or the formula. */
  rule: string | null
  /** The calculation's expression without its leading "=". */
  formula: string | null
}

type Config = SheetDefinitionVersion['configuration']

function typeLabel(logicalType: string): string {
  switch (logicalType) {
    case 'integer':
    case 'decimal':
      return 'Number'
    case 'reference':
      return 'Record link'
    case 'boolean':
      return 'Yes or no'
    case 'date':
      return 'Date'
    case 'timestamp':
      return 'Date and time'
    case 'category':
      return 'Choice'
    default:
      return 'Text'
  }
}

/** "10–300", "≤ 1.5", "≥ 0"; null when the column has no numeric rule. */
export function numericRule(validation: {
  min?: number
  max?: number
}): string | null {
  const { min, max } = validation
  if (min !== undefined && max !== undefined) return `${min}–${max}`
  if (max !== undefined) return `≤ ${max}`
  if (min !== undefined) return `≥ ${min}`
  return null
}

export function modelLabel(modelKey: string): string {
  const spaced = modelKey.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function sheetColumnRows(config: Config): SheetColumnRow[] {
  const order = new Map(
    config.presentation.columnOrder.map((id, index) => [id, index]),
  )
  const calculations = new Map(config.calculations.map((c) => [c.id, c]))
  return [...config.columns]
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((column) => {
      const field = column.field
      const calc =
        column.source.kind === 'calculated'
          ? calculations.get(column.source.calculationId)
          : undefined
      const target = field.relationship?.target
      const formula = calc ? calc.expression.source.replace(/^=/, '') : null
      return {
        id: column.id,
        label: field.label,
        source: calc
          ? 'ƒx'
          : target?.kind === 'model'
            ? modelLabel(target.modelKey)
            : column.source.kind === 'bound'
              ? 'Dataset'
              : 'Typed in sheet',
        calculated: Boolean(calc),
        type: typeLabel(field.logicalType),
        unit: field.quantity?.storageUnit ?? null,
        required: !field.nullable,
        rule: calc
          ? formula
          : (numericRule(field.validation) ?? field.description),
        formula,
      }
    })
}

/** One entry of the Sections list: "Objective · Text". */
export interface SectionEntry {
  placement: NotebookTemplatePlacement
  name: string
  subtitle: string
}

function payloadText(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key]
  return typeof value === 'string' && value ? value : null
}

export function placementName(placement: NotebookTemplatePlacement): string {
  if (placement.kind === 'section_placeholder') return placement.label
  if (placement.kind === 'sheet') return placement.title ?? 'Sheet'
  return payloadText(placement.payload, 'title') ?? placement.blockType
}

export function describeSections(
  placements: NotebookTemplatePlacement[],
  sheets: SheetVersionLookup,
): SectionEntry[] {
  return [...placements]
    .sort((a, b) => a.order - b.order)
    .map((placement) => {
      const name = placementName(placement)
      if (placement.kind === 'sheet') {
        const count = sheets.get(placement.definitionVersionId)?.configuration
          .columns.length
        return {
          placement,
          name,
          subtitle: `Sheet · ${count ?? '…'} columns`,
        }
      }
      if (placement.kind === 'section_placeholder')
        return { placement, name, subtitle: 'Empty section' }
      const p = placement.payload
      switch (placement.blockType) {
        case 'rich_text':
          return { placement, name, subtitle: 'Text' }
        case 'materials': {
          const label = payloadText(p, 'label')
          return {
            placement,
            name,
            subtitle: label ? `Record list · ${label}` : 'Record list',
          }
        }
        case 'protocol_reference': {
          const protocol = payloadText(p, 'protocol')
          return {
            placement,
            name,
            subtitle: protocol
              ? `From protocol ${protocol} v${String(p.version ?? '')}`.trim()
              : 'From protocol',
          }
        }
        case 'chart': {
          const source = payloadText(p, 'source')
          return {
            placement,
            name,
            subtitle: source ? `Chart from ${source}` : 'Chart',
          }
        }
        case 'metric': {
          const fields = Array.isArray(p.fields) ? p.fields.length : 0
          return { placement, name, subtitle: `Fields · ${fields}` }
        }
        default:
          return { placement, name, subtitle: placement.blockType }
      }
    })
}

/** What changed between two placement lists, in the order a reader scans:
 * sections added or removed, sheet columns added or changed, narrative text
 * and summary fields changed. Sheet columns are read from the pinned versions. */
export function diffTemplatePlacements(
  before: NotebookTemplatePlacement[] | null,
  after: NotebookTemplatePlacement[],
  sheets: SheetVersionLookup,
): FieldChange[] {
  const changes: FieldChange[] = []
  const prior = new Map((before ?? []).map((p) => [p.id, p]))
  const next = new Map(after.map((p) => [p.id, p]))
  const sheetSubtitle = (p: NotebookTemplatePlacement) =>
    describeSections([p], sheets)[0].subtitle

  for (const placement of [...after].sort((a, b) => a.order - b.order)) {
    const old = prior.get(placement.id)
    const name = placementName(placement)
    if (!old) {
      changes.push({
        kind: 'Added',
        subject: name,
        detail: sheetSubtitle(placement),
      })
      continue
    }
    if (placement.kind === 'sheet' && old.kind === 'sheet') {
      if (placement.definitionVersionId === old.definitionVersionId) continue
      const oldRows = new Map(
        (sheets.get(old.definitionVersionId)
          ? sheetColumnRows(sheets.get(old.definitionVersionId)!.configuration)
          : []
        ).map((r) => [r.id, r]),
      )
      const newRows = sheets.get(placement.definitionVersionId)
        ? sheetColumnRows(
            sheets.get(placement.definitionVersionId)!.configuration,
          )
        : []
      for (const row of newRows) {
        const was = oldRows.get(row.id)
        if (!was) {
          changes.push({
            kind: 'Added',
            subject: `${row.label} column`,
            detail: `${name}${row.calculated ? ` · ƒx = ${row.formula}` : ''}${row.rule && !row.calculated ? ` · ${row.rule}` : ''}`,
          })
        } else if (!row.calculated && (was.rule ?? '') !== (row.rule ?? '')) {
          changes.push({
            kind: 'Changed',
            subject: `${row.label} rule`,
            detail: name,
            from: was.rule ?? '—',
            to: row.rule ?? '—',
          })
        }
      }
      for (const [id, row] of oldRows)
        if (!newRows.some((r) => r.id === id))
          changes.push({
            kind: 'Removed',
            subject: `${row.label} column`,
            detail: name,
          })
      continue
    }
    if (placement.kind === 'narrative' && old.kind === 'narrative') {
      if (JSON.stringify(placement.payload) === JSON.stringify(old.payload))
        if (placement.blockType === old.blockType) continue
      const was = Array.isArray(old.payload.fields)
        ? (old.payload.fields as string[])
        : null
      const now = Array.isArray(placement.payload.fields)
        ? (placement.payload.fields as string[])
        : null
      if (was && now) {
        for (const field of now.filter((f) => !was.includes(f)))
          changes.push({
            kind: 'Added',
            subject: `${field} field`,
            detail: name,
          })
        continue
      }
      changes.push({
        kind: 'Changed',
        subject: name,
        detail: sheetSubtitle(placement),
      })
    }
  }
  for (const [id, placement] of prior)
    if (!next.has(id))
      changes.push({
        kind: 'Removed',
        subject: placementName(placement),
        detail: sheetSubtitle(placement),
      })
  const rank = { Added: 0, Changed: 1, Removed: 2 } as const
  return changes
    .map((change, index) => ({ change, index }))
    .sort(
      (a, b) => rank[a.change.kind] - rank[b.change.kind] || a.index - b.index,
    )
    .map(({ change }) => change)
}

/** The one-line Change column: the first reason, else the diff in words. */
export function summariseTemplateChanges(
  changes: FieldChange[],
  reason: string | null,
  isFirst: boolean,
  sectionCount: number,
): string {
  if (reason) return reason
  if (isFirst) return `Created with ${sectionCount} sections`
  if (!changes.length) return 'No changes'
  return changes.map((c) => `${c.kind} ${c.subject}`).join('; ')
}
