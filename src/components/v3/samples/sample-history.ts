import type { SampleEvent } from '#/lib/samples'

/**
 * LAB-03 / step 4 — presentation helpers for the sample History tab. The tab
 * renders the canonical `api.sample_events` stream; these pure functions turn a
 * raw event into the design's When / Who / Action / Detail / Change columns
 * without inventing data. Anything the event does not carry is reported as
 * missing (`null`) so the table can show an honest em dash.
 */

const ACTION_LABELS: Record<string, string> = {
  create: 'Registered',
  receive: 'Received',
  consume: 'Withdrew',
  transfer: 'Moved',
  edit: 'Edited',
  archive: 'Archived',
  restore: 'Restored',
}

/** Human action for a sample_events operation, e.g. consume → "Withdrew". */
export function sampleEventAction(operation: string): string {
  return ACTION_LABELS[operation] ?? operation.replace(/_/g, ' ')
}

/** The event's free text, falling back to a location transition where useful. */
export function sampleEventDetail(event: SampleEvent): string | null {
  if (event.notes) return event.notes
  if (event.fromLocation && event.toLocation) {
    return `${event.fromLocation} → ${event.toLocation}`
  }
  if (event.toLocation) return event.toLocation
  if (event.fromLocation) return event.fromLocation
  return null
}

function formatQuantity(value: number): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 })
}

/**
 * Quantity change in the design's "Volume 14,950 → 4,600 mL" form. Returns
 * null for events that carry no quantity movement (transfer/edit/archive…).
 */
export function sampleEventChange(event: SampleEvent): string | null {
  if (event.quantityBefore == null || event.quantityAfter == null) return null
  const unit = event.quantityUnit ? ` ${event.quantityUnit}` : ''
  return `Volume ${formatQuantity(event.quantityBefore)} → ${formatQuantity(event.quantityAfter)}${unit}`
}

// Month abbreviations are fixed so the output does not depend on the
// environment ICU data (Node prints "Sept" for en-GB, browsers "Sep").
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Design "When" cell: "23 Sep 09:15". Deterministic UTC to avoid SSR drift. */
export function formatSampleEventTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

/** Full timestamp for the cell `title`, e.g. "23 Sep 2026, 09:15 UTC". */
export function formatSampleEventTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}
