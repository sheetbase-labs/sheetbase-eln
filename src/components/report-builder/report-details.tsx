/** OPS-007 — Report details inspector: document properties, review status,
 * generation audit and export settings. Reuses template/review/approval by
 * reference rather than reimplementing them. */
import { Download, FileCheck2, History } from 'lucide-react'

import { Badge, Button } from '#/components/ui'
import {
  OUTPUT_FORMAT_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_TOKENS,
} from '#/lib/report-builder'
import type {
  OutputFormat,
  ReportDefinition,
  ReportGeneration,
  ValidationSummary,
} from '#/lib/report-builder'
import { cn } from '#/lib/utils'

export interface ReportDetailsProps {
  report: ReportDefinition | null
  generations: ReportGeneration[]
  validation: ValidationSummary | null
  outputFormat: OutputFormat
  onOutputFormatChange: (format: OutputFormat) => void
  onValidate: () => void
  onGenerate: () => void
  isGenerating: boolean
  isValidating: boolean
  timeZone: string
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
  outputFormat,
  onOutputFormatChange,
  onValidate,
  onGenerate,
  isGenerating,
  isValidating,
  timeZone,
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
          Document
        </h2>
        <dl className="space-y-1.5 text-sm">
          <Row label="Title" value={report.title} />
          <Row label="Subtitle" value={report.subtitle ?? '—'} />
          <Row label="Document ID" value={report.documentIdentifier} />
          <Row
            label="Status"
            value={
              <Badge className={cn(REPORT_STATUS_TOKENS[report.status])}>
                {REPORT_STATUS_LABELS[report.status]}
              </Badge>
            }
          />
          <Row label="Version" value={`v${report.version}`} />
          <Row
            label="Template"
            value={report.templateRecordId ? 'Linked template' : 'None'}
          />
          <Row
            label="Review"
            value={
              report.reviewSubmissionId ? 'Linked submission' : 'Not submitted'
            }
          />
        </dl>
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
                <Badge
                  className={cn(
                    validation.ready
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700',
                  )}
                >
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
        <Button
          size="sm"
          variant="outline"
          className="mt-3 w-full"
          onClick={onValidate}
          disabled={isValidating}
        >
          <FileCheck2 className="size-4" />
          {isValidating ? 'Validating…' : 'Validate sources'}
        </Button>
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
            <Row
              label="Format"
              value={OUTPUT_FORMAT_LABELS[latest.outputFormat]}
            />
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

      <section className="p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          Export
        </h2>
        <div className="mb-3 flex gap-1">
          {(Object.keys(OUTPUT_FORMAT_LABELS) as OutputFormat[]).map((fmt) => (
            <Button
              key={fmt}
              size="sm"
              variant={outputFormat === fmt ? 'default' : 'outline'}
              onClick={() => onOutputFormatChange(fmt)}
            >
              {OUTPUT_FORMAT_LABELS[fmt]}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          className="w-full"
          onClick={onGenerate}
          disabled={isGenerating}
        >
          <Download className="size-4" />
          {isGenerating
            ? 'Generating…'
            : `Export ${OUTPUT_FORMAT_LABELS[outputFormat]}`}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Export records the generation inputs, version, actor and output
          checksum. Same inputs reproduce the same checksum.
        </p>
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
