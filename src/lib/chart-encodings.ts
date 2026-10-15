/**
 * R5-STUDIO-02 — chart encoding roles and the single field-role grouping.
 *
 * A chart is authored by assigning a dataset field to one encoding role
 * (x, y, colour, size, facet). Two authoring paths share this module so they
 * cannot disagree about what a role accepts or why an assignment is refused:
 *
 *  - the drag-and-drop field list and role slots (the primary surface), and
 *  - the `<select>` controls, kept as the keyboard and fallback route.
 *
 * Any assignment the two paths produce therefore reaches `ChartSpec.fields`
 * through the same binding, and an incompatible one is refused with a stated
 * reason rather than silently reassigned.
 *
 * The grouping is the one the configurator already used — numeric
 * (decimal/integer) columns are measured values, category/text/boolean are run
 * metadata — rather than a second classification invented here.
 */
import { CHART_TYPES_NULL_X } from '#/lib/chart-spec'
import type { ChartColumn, ChartSpec, ChartType } from '#/lib/chart-spec'

export const CHART_ROLES = ['x', 'y', 'colour', 'size', 'facet'] as const
export type ChartRole = (typeof CHART_ROLES)[number]

/** The `DataTransfer` type a dragged field carries to a role slot. */
export const FIELD_DRAG_TYPE = 'text/x-field'

/** The `ChartSpec.fields` key each role writes. */
export const ROLE_SPEC_KEY: Record<
  ChartRole,
  'x' | 'y' | 'color' | 'size' | 'facet'
> = {
  x: 'x',
  y: 'y',
  colour: 'color',
  size: 'size',
  facet: 'facet',
}

export const ROLE_LABEL: Record<ChartRole, string> = {
  x: 'X-axis',
  y: 'Y-axis',
  colour: 'Colour',
  size: 'Size',
  facet: 'Facet',
}

/** Row groups in the field list, in display order. */
export const FIELD_GROUPS = ['Measured', 'Derived', 'Run metadata'] as const
export type FieldGroup = (typeof FIELD_GROUPS)[number]

const MEASURED_LOGICAL_TYPES = ['decimal', 'integer']
const CATEGORY_LOGICAL_TYPES = ['category', 'text', 'boolean']

/** A measured value the chart plots (the existing numeric grouping). */
export function isMeasuredColumn(column: ChartColumn): boolean {
  return MEASURED_LOGICAL_TYPES.includes(column.logicalType)
}

/** A grouping key the chart splits series or facets on. */
export function isCategoryColumn(column: ChartColumn): boolean {
  return CATEGORY_LOGICAL_TYPES.includes(column.logicalType)
}

/**
 * The field list row group. Nothing is reported as `Derived`: the chart source
 * carries no calculated marker, so a label heuristic would invent one. The
 * group stays in `FIELD_GROUPS` for when the schema exposes that marker.
 */
export function fieldGroup(column: ChartColumn): FieldGroup {
  return isMeasuredColumn(column) ? 'Measured' : 'Run metadata'
}

/** The non-empty field-list groups for these columns, in display order. */
export function groupedFields(
  columns: ChartColumn[],
): { group: FieldGroup; columns: ChartColumn[] }[] {
  return FIELD_GROUPS.map((group) => ({
    group,
    columns: columns.filter((column) => fieldGroup(column) === group),
  })).filter((entry) => entry.columns.length > 0)
}

export type RoleCheck = { ok: true } | { ok: false; reason: string }

/**
 * Whether the chart type carries the role at all. A heatmap cell is a count or
 * a value field, so it has no colour or size encoding; histogram and box charts
 * reject an x mapping (`CHART_TYPES_NULL_X`). Assigning either would build a
 * spec `validateChartSpec` refuses.
 */
export function roleAvailableForType(
  role: ChartRole,
  type: ChartType,
): RoleCheck {
  if (role === 'x' && (CHART_TYPES_NULL_X as readonly string[]).includes(type))
    return {
      ok: false,
      reason: `A ${type} chart has no X-axis mapping.`,
    }
  if (type === 'heatmap' && (role === 'colour' || role === 'size'))
    return {
      ok: false,
      reason: `A heatmap has no ${ROLE_LABEL[role].toLowerCase()} encoding; its cells are row counts or a value field.`,
    }
  return { ok: true }
}

/** Whether `column` may fill `role` on a `type` chart, with a stated reason. */
export function checkAssignment(
  role: ChartRole,
  column: ChartColumn,
  type: ChartType,
): RoleCheck {
  const availability = roleAvailableForType(role, type)
  if (!availability.ok) return availability
  if (role === 'colour' || role === 'facet')
    return isCategoryColumn(column)
      ? { ok: true }
      : {
          ok: false,
          reason: `${ROLE_LABEL[role]} needs a category field; “${column.label}” is ${column.logicalType}.`,
        }
  return isMeasuredColumn(column)
    ? { ok: true }
    : {
        ok: false,
        reason: `${ROLE_LABEL[role]} needs a measured number; “${column.label}” is ${column.logicalType}.`,
      }
}

/**
 * Columns a role offers, in schema order — the option list both authoring
 * paths read, so a keyboard choice can never be one the drag path refuses.
 */
export function columnsForRole(
  role: ChartRole,
  columns: ChartColumn[],
  type: ChartType,
): ChartColumn[] {
  if (!roleAvailableForType(role, type).ok) return []
  return columns.filter((column) => checkAssignment(role, column, type).ok)
}

/** The field currently bound to a role, or null. */
export function boundFieldId(spec: ChartSpec, role: ChartRole): string | null {
  return spec.fields[ROLE_SPEC_KEY[role]]?.fieldId ?? null
}
