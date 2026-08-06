/** OPS-007 — Report preview: rendered report from frozen evidence only. */
import { useMemo } from 'react'
import { Badge } from '#/components/ui'
import {
  REPORT_STATUS_BADGE_VARIANT,
  REPORT_STATUS_LABELS,
  SECTION_TYPE_LABELS,
  SOURCE_TYPE_LABELS,
  VALIDATION_STATUS_BADGE_VARIANT,
  VALIDATION_STATUS_LABELS,
  buildGenerationInputs,
  computeChecksum,
  renderReportHtml,
} from '#/lib/report-builder'
import type {
  ReportDefinition,
  ReportSection,
  ValidationSummary,
} from '#/lib/report-builder'
import { useAsync } from './use-async-checksum'

export interface ReportPreviewProps {
  report: ReportDefinition | null
  sections: ReportSection[]
  validation: ValidationSummary | null
  generationsChecksum: string | null
}

export function ReportPreview({
  report,
  sections,
  validation,
  generationsChecksum,
}: ReportPreviewProps) {
  const ordered = useMemo(
    () => sections.slice().sort((a, b) => a.position - b.position),
    [sections],
  )
  const previewHtml = useMemo(
    () => (report ? renderReportHtml(report, ordered) : ''),
    [report, ordered],
  )
  const previewChecksum = useAsync(
    async () =>
      report
        ? computeChecksum(buildGenerationInputs(report, ordered, 'html'))
        : null,
    [report, ordered],
  )

  if (!report)
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Create or select a report to preview it here.
      </div>
    )

  const matchesGeneration =
    generationsChecksum != null &&
    previewChecksum != null &&
    generationsChecksum === previewChecksum

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border/60 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{report.title}</h2>
          <Badge variant={REPORT_STATUS_BADGE_VARIANT[report.status]}>
            {REPORT_STATUS_LABELS[report.status]}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {report.documentIdentifier} · v{report.version}
          </span>
        </div>
        {report.subtitle ? (
          <p className="mt-1 text-sm italic text-muted-foreground">
            {report.subtitle}
          </p>
        ) : null}
        {validation ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {validation.valid}/{validation.sections} valid
            </span>
            {validation.missingSource > 0 ? (
              <Badge variant="danger">
                {validation.missingSource} missing
              </Badge>
            ) : null}
            {validation.stale > 0 ? (
              <Badge variant="warning">
                {validation.stale} stale
              </Badge>
            ) : null}
            {validation.locked > 0 ? (
              <Badge variant="info">
                {validation.locked} locked
              </Badge>
            ) : null}
            <Badge variant={validation.ready ? 'success' : 'warning'}>
              {validation.ready ? 'Ready to export' : 'Not ready'}
            </Badge>
            {generationsChecksum ? (
              <Badge
                variant="outline"
                className={
                  matchesGeneration ? 'text-success' : 'text-warning-foreground'
                }
                title={`${generationsChecksum.slice(0, 12)}…`}
              >
                {matchesGeneration
                  ? 'Checksum matches generation'
                  : 'Checksum differs from last generation'}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-lg font-semibold">{report.title}</h2>
          {report.subtitle ? (
            <p className="text-sm italic text-muted-foreground">
              {report.subtitle}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {report.documentIdentifier} · v{report.version}
          </p>
          <div className="mt-4 space-y-4">
            {ordered.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sections. Add sections from the outline to build the report.
              </p>
            ) : (
              ordered.map((section, index) => (
                <section
                  key={section.id}
                  className="border-b border-border/60 pb-3"
                >
                  <h3 className="text-sm font-semibold">
                    {index + 1}. {section.title}
                  </h3>
                  {section.description ? (
                    <p className="text-sm text-muted-foreground">
                      {section.description}
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant="outline" className="font-normal">
                      {SECTION_TYPE_LABELS[section.sectionType]}
                    </Badge>
                    <Badge variant="outline" className="font-normal">
                      {SOURCE_TYPE_LABELS[section.sourceType]}
                    </Badge>
                    {section.sourceRevisionId ? (
                      <span className="text-muted-foreground">
                        revision {section.sourceRevisionId.slice(0, 8)}
                      </span>
                    ) : (
                      <span className="text-warning-foreground">no frozen source</span>
                    )}
                    <Badge
                      variant={
                        VALIDATION_STATUS_BADGE_VARIANT[
                          section.validationStatus
                        ]
                      }
                      className="text-xs"
                    >
                      {VALIDATION_STATUS_LABELS[section.validationStatus]}
                    </Badge>
                  </div>
                  {Object.keys(section.frozenPayload).length > 0 ? (
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted/30 p-2 text-xs">
                      {JSON.stringify(section.frozenPayload, null, 2)}
                    </pre>
                  ) : null}
                </section>
              ))
            )}
          </div>
        </div>
      </div>
      <details className="border-t border-border/60 bg-muted/30 px-5 py-2 text-xs">
        <summary className="cursor-pointer select-none font-medium text-muted-foreground">
          HTML source (PDF-ready, {previewHtml.length} bytes)
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-background p-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {previewHtml}
        </pre>
      </details>
    </div>
  )
}
