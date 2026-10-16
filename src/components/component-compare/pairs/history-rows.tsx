import { ObjectHistoryTimeline } from '#/components/audit/object-history-timeline'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
  ComparisonRow,
} from '#/components/component-compare/types'
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '#/components/reui/timeline'
import type { AuditEventWire } from '#/lib/audit-history'

/**
 * Pair 2 — the history rows.
 *
 * Ours: the shared history surface (`src/components/audit/history-timeline.tsx`,
 * built on the ReUI `timeline` item) reached through the mapping the product
 * uses — `ObjectHistoryTimeline`, so the column also carries the correlation
 * grouping, the semantic phrase, the before→after chips, the deep link and the
 * `Raw event` disclosure. The three panels that used to carry a row layout each
 * (`AuditTrail`, `ObjectHistoryTimeline`, `RecordHistoryTimeline`) now all map
 * onto this one surface; this column measures it with a wire change-event
 * stream, the shape the dataset History tab and the sheet history dialog render.
 *
 * Theirs: `@reui/timeline` (base-nova) composed the way the registry's own
 * examples compose it — date above title in the header, a plain indicator with
 * no icon, the separator, the detail in the content — with the row chrome
 * restyled to Sheetbase tokens, because an adoption means restyling anyway.
 * The published indicator is a 1rem hollow ring; the restyle gives it the
 * app's 2rem well (see the item's header comment and the record's costs).
 *
 * The two columns differ in where their states come from, and the record says
 * so: the shared surface ships its own loading skeleton, empty message and
 * error notice, and this column drives them; the item ships none, so the empty,
 * loading and error cells of *its* column are the harness's own notices.
 *
 * Both columns are handed the same fixture and the same state by the harness.
 */

/**
 * The fixture's rows are change events: the row's name is the actor and the
 * subject's name, its value is the before→after pair, its unit is the long
 * field label, its note is the detail line, and its kind picks the operation
 * and entity so every icon the vocabulary has is exercised.
 */
const OPERATIONS = [
  'create',
  'update',
  'move',
  'delete',
  'archive',
  'restore',
  'link',
  'unlink',
  'quarantine',
  'lock',
  'amend',
  'revoke',
] as const

const ENTITY_TYPES = [
  'record',
  'file',
  'folder',
  'dataset',
  'sheet_instance',
  'signature',
] as const

/** A fixed clock: identical instants on every run, so the two sides can be compared. */
const CLOCK = Date.parse('2026-10-16T09:14:00.000Z')

function createdAt(index: number): string {
  return new Date(CLOCK - index * 3_600_000).toISOString()
}

function wireEvent(row: ComparisonRow, index: number): AuditEventWire {
  const actorUserId = row.kind === null ? null : `user-${index + 1}`
  return {
    sequence: index + 1,
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    createdAt: createdAt(index),
    entityType: ENTITY_TYPES[index % ENTITY_TYPES.length] ?? 'record',
    entityUuid: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    operation: OPERATIONS[index % OPERATIONS.length] ?? 'update',
    recordId: null,
    projectId: '20000000-0000-4000-8000-000000000001',
    actorUserId,
    // The fixture's long-name axis reaches the row through the actor and the
    // subject's title, exactly as a real event carries them.
    actorName: row.name,
    actorCredentialId: null,
    clientId: null,
    payload: {
      title: row.note ?? row.name,
      changes: {
        // The fixture's long-unit axis becomes a field label and a value.
        [row.unit]: {
          from: row.value,
          to: index % 2 === 0 ? row.value : row.unit,
        },
        amount: { from: row.value, to: 0 },
      },
    },
  }
}

function wireEvents(rows: readonly ComparisonRow[]): AuditEventWire[] {
  return rows.map(wireEvent)
}

/** Ours: the shared history surface, through the product's own mapping. */
function SharedHistoryColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows

  return (
    <div data-comparison-list="ours" data-history-surface="shared">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      <ObjectHistoryTimeline
        events={wireEvents(rows)}
        loading={scenario.state === 'loading'}
        error={
          scenario.state === 'error' ? 'History could not be loaded.' : null
        }
      />
    </div>
  )
}

/** Theirs: `@reui/timeline` composed as the registry's examples compose it. */
function ReuiTimelineColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div data-comparison-list="theirs" data-history-surface="reui-timeline">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {/* The registry's default is `defaultValue={1}`, which marks the first
          item completed; history has no completion, so the steps are inert. */}
      <Timeline value={0} className="m-0">
        {rows.map((row, index) => (
          <TimelineItem key={row.id} step={index + 1} data-row-id={row.id}>
            <TimelineHeader>
              <TimelineDate dateTime={createdAt(index)}>
                {createdAt(index).slice(11, 16)}
              </TimelineDate>
              <TimelineTitle>{row.name}</TimelineTitle>
            </TimelineHeader>
            <TimelineIndicator />
            <TimelineSeparator />
            <TimelineContent>
              <span className="text-fg-muted">
                {OPERATIONS[index % OPERATIONS.length]} ·{' '}
                {ENTITY_TYPES[index % ENTITY_TYPES.length]} · {row.unit}
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-1 font-mono text-xs">
                <span className="text-fg-muted line-through">
                  {String(row.value)}
                </span>
                <span aria-hidden>→</span>
                <span>{row.note ?? row.unit}</span>
              </div>
            </TimelineContent>
          </TimelineItem>
        ))}
      </Timeline>
    </div>
  )
}

export const historyRowsPair: ComparisonPair = {
  id: 'history-rows',
  title: 'History rows',
  job: 'Render a chronological list of audit events as readable rows',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — shared history surface on the ReUI timeline item',
    source: 'src/components/audit/history-timeline.tsx',
    Column: SharedHistoryColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — ReUI timeline (base-nova)',
    source: 'src/components/reui/timeline.tsx (registry: @reui/timeline)',
    Column: ReuiTimelineColumn,
  },
}
