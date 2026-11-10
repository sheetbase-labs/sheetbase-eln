import type { RecordModelVersionDefinition } from '#/lib/record-model-versions'

/** One field of a record model version, as the Fields and Edit views read it. */
export type ModelVersionField = RecordModelVersionDefinition['fields'][number]

/** The section a field sits in; fields from before sections have none. */
export const UNSECTIONED = 'Fields'

export function fieldSection(field: ModelVersionField): string {
  return field.section || UNSECTIONED
}

export function fieldSource(field: ModelVersionField): string {
  return field.source || 'By hand'
}

/** "To release": the field is optional until the record is released. */
export function fieldRequiredFor(field: ModelVersionField): 'release' | null {
  return field.required_for === 'release' ? 'release' : null
}

/** "Number, 0 dp", "Choice · 3 options", "Text": the Type column. */
export function fieldTypeLabel(field: ModelVersionField): string {
  const live = (field.options ?? []).filter((o) => o.lifecycle !== 'retired')

  switch (field.logical_type) {
    case 'integer':
    case 'decimal': {
      const places =
        field.decimal_places ?? (field.logical_type === 'decimal' ? 1 : 0)

      return `Number, ${places} dp`
    }

    case 'category':
      return `Choice · ${live.length} option${live.length === 1 ? '' : 's'}`
    case 'boolean':
      return 'Yes or no'
    case 'date':
      return 'Date'
    case 'timestamp':
      return 'Date and time'
    case 'reference':
      return 'Link'
    default:
      return 'Text'
  }
}

export function fieldUnit(field: ModelVersionField): string | null {
  const unit = field.unit

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The version schema validates string or structured units; only the legacy string carries this presentation value.
  if (typeof unit === 'string' && unit) return unit
  const stored = field.quantity?.storageUnit

  return stored || null
}

/** "≤ 30", "0–100", "≥ 1": the Rule column, from a field's own validation. */
export function fieldRule(field: ModelVersionField): string | null {
  const lo = field.validation.min ?? null
  const hi = field.validation.max ?? null

  if (lo !== null && hi !== null) return `${lo}–${hi}`

  if (hi !== null) return `≤ ${hi}`

  if (lo !== null) return `≥ ${lo}`

  return null
}

export function fieldRequiredLabel(field: ModelVersionField): string {
  if (fieldRequiredFor(field)) return 'To release'

  return field.nullable ? 'No' : 'Yes'
}

/** The sections of a version in display order, each with its fields. */
export function groupFieldsBySection(
  fields: ModelVersionField[],
): { name: string; fields: ModelVersionField[] }[] {
  const groups: { name: string; fields: ModelVersionField[] }[] = []

  for (const field of [...fields].sort(
    (a, b) => a.display_order - b.display_order,
  )) {
    const name = fieldSection(field)
    const group = groups.find((g) => g.name === name)

    if (group) group.fields.push(field)
    else groups.push({ name, fields: [field] })
  }

  return groups
}

export interface FieldChange {
  /** Stable field/dimension/option identity, independent of labels and order. */
  id: string
  kind: 'Added' | 'Removed' | 'Changed'
  /** The field, or "Label option" for an option change. */
  subject: string
  /** What happened, after a middle dot: "Number, 0 dp · Storage". */
  detail: string | null
  /** The old and new value for a Changed row, shown struck through and new. */
  from?: string
  to?: string
}

/** What changed between two versions of a model, in the order a reader scans. */
export function diffModelVersions(
  before: RecordModelVersionDefinition | null,
  after: RecordModelVersionDefinition,
): FieldChange[] {
  const changes: FieldChange[] = []
  const prior = new Map((before?.fields ?? []).map((f) => [f.id, f]))
  const next = new Map(after.fields.map((f) => [f.id, f]))

  for (const field of after.fields) {
    const old = prior.get(field.id)

    if (field.lifecycle === 'retired') {
      // A published field is never deleted; the draft retires it.
      if (old && old.lifecycle !== 'retired')
        changes.push({
          id: `field:${field.id}:removed`,
          kind: 'Removed',
          subject: field.label,
          detail: fieldTypeLabel(field),
        })
      continue
    }

    if (!old) {
      changes.push({
        id: `field:${field.id}:added`,
        kind: 'Added',
        subject: field.label,
        detail: [fieldTypeLabel(field), fieldSection(field)]
          .filter((part) => part !== UNSECTIONED)
          .join(' · '),
      })
      continue
    }

    if (old.label !== field.label)
      changes.push({
        id: `field:${field.id}:name`,
        kind: 'Changed',
        subject: field.label,
        detail: 'Name',
        from: old.label,
        to: field.label,
      })

    if (old.logical_type !== field.logical_type)
      changes.push({
        id: `field:${field.id}:type`,
        kind: 'Changed',
        subject: field.label,
        detail: 'Type',
        from: fieldTypeLabel(old).split(' · ')[0],
        to: fieldTypeLabel(field).split(' · ')[0],
      })

    if (fieldUnit(old) !== fieldUnit(field))
      changes.push({
        id: `field:${field.id}:unit`,
        kind: 'Changed',
        subject: field.label,
        detail: 'Unit',
        from: fieldUnit(old) ?? '—',
        to: fieldUnit(field) ?? '—',
      })

    if (fieldRule(old) !== fieldRule(field))
      changes.push({
        id: `field:${field.id}:rule`,
        kind: 'Changed',
        subject: field.label,
        detail: 'Rule',
        from: fieldRule(old) ?? 'none',
        to: fieldRule(field) ?? 'none',
      })

    if (fieldRequiredLabel(old) !== fieldRequiredLabel(field))
      changes.push({
        id: `field:${field.id}:required`,
        kind: 'Changed',
        subject: field.label,
        detail: 'Required',
        from: fieldRequiredLabel(old),
        to: fieldRequiredLabel(field),
      })
    const oldOptions = new Map((old.options ?? []).map((o) => [o.id, o]))
    const newOptions = new Map((field.options ?? []).map((o) => [o.id, o]))

    for (const [id, option] of oldOptions)
      if (!newOptions.has(id))
        changes.push({
          id: `field:${field.id}:option:${id}:removed`,
          kind: 'Removed',
          subject: `${option.label} option`,
          detail: field.label,
        })

    for (const [id, option] of newOptions)
      if (!oldOptions.has(id) && oldOptions.size > 0)
        changes.push({
          id: `field:${field.id}:option:${id}:added`,
          kind: 'Added',
          subject: `${option.label} option`,
          detail: field.label,
        })
  }

  for (const [id, field] of prior)
    if (!next.has(id))
      changes.push({
        id: `field:${id}:removed`,
        kind: 'Removed',
        subject: field.label,
        detail: fieldTypeLabel(field),
      })

  return changes
}

/** The one-line Change column: "Added Vials left, Changed Passage rule…". */
export function summariseChanges(
  changes: FieldChange[],
  isFirst: boolean,
  fieldCount: number,
): string {
  if (isFirst) return `Created with ${fieldCount} fields`

  if (!changes.length) return 'No field changes'

  return changes
    .map((c) =>
      c.kind === 'Changed' && c.detail
        ? `Changed ${c.subject} ${c.detail.toLowerCase()}`
        : `${c.kind} ${c.subject}`,
    )
    .join('; ')
}
