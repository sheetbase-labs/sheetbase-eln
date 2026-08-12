/** OPS-007 — Report details inspector: document properties, review status,
 * validation snapshot, and generation audit. Primary workflow controls live
 * in the builder workspace so this remains secondary/audit information. */
import { History } from 'lucide-react'

import { ModelProperties } from '#/components/scientific/model-properties'
import { Badge } from '#/components/ui'
import {
  REPORT_STATUS_BADGE_VARIANT,
  REPORT_STATUS_LABELS,
} from '#/lib/report-builder'
import type {
  ReportDefinition,
  ReportGeneration,
  ValidationSummary,
} from '#/lib/report-builder'
import type {
  ModelFieldDefinition,
  ModelFieldRecordValues,
} from '#/lib/model-fields'

export interface ReportDetailsProps {
  report: ReportDefinition | null
  generations: ReportGeneration[]
  validation: ValidationSummary | null
  timeZone: string
  modelFields: ModelFieldDefinition[]
  modelFieldValues: ModelFieldRecordValues | null
  modelFieldsSaving?: boolean
  onSaveModelFields?: (values: Record<string, unknown>) => void
}

function formatDate(value: string | null, timeZone: string): string {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      }).format(new Date(value))
    : '—'
}

export function ReportDetails({
  report,
  generations,
  validation,
  timeZone,
  modelFields,
  modelFieldValues,
  modelFieldsSaving,
  onSaveModelFields,
}: ReportDetailsProps) {
  if (!report)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No report selected.
      </div>
    )

  const latest = generations.length > 0 ? generations[0] : null

  return (
    <div className="flex h-full flex-col overflow-auto">
      <section className="border-b border-border/60 p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          Properties
        </h2>
        <ModelProperties
          lockedProperties={[
            { key: 'title', label: 'Title', value: report.title },
            {
              key: 'subtitle',
              label: 'Subtitle',
              value: report.subtitle ?? '—',
            },
            {
              key: 'identifier',
              label: 'Document ID',
              value: report.documentIdentifier,
            },
            {
              key: 'status',
              label: 'Status',
              value: (
                <Badge variant={REPORT_STATUS_BADGE_VARIANT[report.status]}>
                  {REPORT_STATUS_LABELS[report.status]}
                </Badge>
              ),
            },
            { key: 'version', label: 'Version', value: `v${report.version}` },
            {
              key: 'template',
              label: 'Template',
              value: report.templateRecordId ? 'Linked template' : 'None',
            },
            {
              key: 'review',
              label: 'Review',
              value: report.reviewSubmissionId
                ? 'Linked submission'
                : 'Not submitted',
            },
          ]}
          definitions={modelFields}
          values={modelFieldValues?.customFields ?? {}}
          recordLocked={modelFieldValues?.locked ?? false}
          saving={modelFieldsSaving}
          onSave={onSaveModelFields}
        />
      </section>

      <section className="border-b border-border/60 p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          Validation
        </h2>
        {validation ? (
          <dl className="space-y-1.5 text-sm">
            <Row label="Sections" value={String(validation.sections)} />
            <Row label="Valid" value={String(validation.valid)} />
            <Row
              label="Missing sources"
              value={String(validation.missingSource)}
            />
            <Row label="Stale refs" value={String(validation.stale)} />
            <Row label="Locked" value={String(validation.locked)} />
            <Row
              label="Ready"
              value={
                <Badge variant={validation.ready ? 'success' : 'warning'}>
                  {validation.ready ? 'Yes' : 'No'}
                </Badge>
              }
            />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            Run validation to check sources.
          </p>
        )}
      </section>

      <section className="border-b border-border/60 p-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
          <History className="size-3.5" /> Generation audit
        </h2>
        {latest ? (
          <dl className="space-y-1.5 text-sm">
            <Row
              label="Generated"
              value={formatDate(latest.generatedAt, timeZone)}
            />
            <Row label="Format" value={latest.outputFormat.toUpperCase()} />
            <Row label="Actor" value={latest.actorUserId} />
            <Row
              label="Checksum"
              value={
                <code className="text-xs break-all">
                  {latest.outputChecksum.slice(0, 16)}…
                </code>
              }
            />
            <Row
              label="Size"
              value={`${latest.outputSizeBytes.toLocaleString()} bytes`}
            />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            No generations yet. Export to record one.
          </p>
        )}
        {generations.length > 1 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {generations.length} generations recorded.
          </p>
        ) : null}
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-medium">{value}</dd>
    </div>
  )
}
