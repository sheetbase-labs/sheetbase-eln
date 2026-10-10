/**
 * ScientificRecordSummary — inspector summary for a sample, material or
 * protocol record (SCI-001).
 *
 * Renders the shared record identity (identifier, kind, status), the
 * configurable properties projected through the workspace's field
 * definitions, and the linked-records counts. Reuses StatusBadge and the
 * shared inspector/property-list patterns. Archived records render honestly
 * with an “Archived” marker; orphaned property values (retired fields) are
 * flagged but preserved.
 *
 * Decision 0026; follows DESIGN.md and the concept system.
 */
import { Icon } from '#/components/icons'

import { StatusBadge } from '#/components/scientific/status-badge'
import { cn } from '#/lib/utils'
import {
  formatPropertyValue,
  isScientificRecordKind,
  summariseProperties,
} from '#/lib/scientific-records'
import type {
  PropertySummaryEntry,
  RecordFieldDefinition,
} from '#/lib/scientific-records'
import type { NotebookRecord } from '#/lib/notebook-data'

const KIND_DOMAIN = {
  sample: 'sample',
  material: 'material',
  protocol_template: 'protocol',
} as const

const KIND_LABEL = {
  sample: 'Sample',
  material: 'Material',
  protocol_template: 'Protocol',
} as const

export interface ScientificRecordSummaryProps {
  record: NotebookRecord
  fieldDefinitions: RecordFieldDefinition[]
  linkedCounts?: { label: string; count: number }[]
  loading?: boolean
  className?: string
}

export function ScientificRecordSummary({
  record,
  fieldDefinitions,
  linkedCounts,
  loading,
  className,
}: ScientificRecordSummaryProps) {
  const kind = isScientificRecordKind(record.kind) ? record.kind : null
  const entries = kind
    ? summariseProperties(kind, record.properties, fieldDefinitions)
    : []

  return (
    <div className={cn('space-y-4', className)}>
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {record.identifier}
          </span>
          {record.archivedAt ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Icon name="archive" size={12} /> Archived
            </span>
          ) : null}
        </div>
        <h3 className="text-base font-semibold leading-tight">
          {record.title}
        </h3>
        {kind ? (
          <StatusBadge
            status={record.status}
            domain={KIND_DOMAIN[kind]}
            size="sm"
          />
        ) : null}
      </header>

      <section>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {kind ? `${KIND_LABEL[kind]} properties` : 'Properties'}
        </h4>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading properties…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No properties defined.
          </p>
        ) : (
          <dl className="space-y-1.5">
            {entries.map((entry) => (
              <PropertyRow key={entry.fieldName} entry={entry} />
            ))}
          </dl>
        )}
      </section>

      {linkedCounts && linkedCounts.length > 0 ? (
        <section>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Linked records
          </h4>
          <ul className="space-y-1">
            {linkedCounts.map((c) => (
              <li
                key={c.label}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">{c.label}</span>
                <span className="font-medium">{c.count}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function PropertyRow({ entry }: { entry: PropertySummaryEntry }) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 text-sm',
        entry.orphaned && 'text-muted-foreground',
      )}
    >
      <dt className="shrink-0 text-muted-foreground">
        {entry.label}
        {entry.orphaned ? (
          <span
            className="ml-1 text-xs"
            title="This field is retired or no longer defined"
          >
            ⚠
          </span>
        ) : null}
      </dt>
      <dd className="text-right font-medium">{formatPropertyValue(entry)}</dd>
    </div>
  )
}
