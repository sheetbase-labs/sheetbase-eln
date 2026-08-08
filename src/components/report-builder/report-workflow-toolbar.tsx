/** OPS-007 — Main-workspace Build → Validate → Download Word controls. */
import { Download, FileCheck2, PenLine } from 'lucide-react'

import { Badge, Button } from '#/components/ui'
import type { ReportDefinition, ValidationSummary } from '#/lib/report-builder'

export interface ReportWorkflowToolbarProps {
  report: ReportDefinition | null
  validation: ValidationSummary | null
  isValidating: boolean
  isExporting: boolean
  onValidate: () => void
  onExport: () => void
}

function validationMessage(validation: ValidationSummary | null): string {
  if (!validation) return 'Validate sources before downloading Word.'
  if (validation.ready) return 'Sources validated. Word document is ready.'
  const issues = validation.missingSource + validation.stale
  return `${issues} source ${issues === 1 ? 'issue' : 'issues'} must be resolved before export.`
}

export function ReportWorkflowToolbar({
  report,
  validation,
  isValidating,
  isExporting,
  onValidate,
  onExport,
}: ReportWorkflowToolbarProps) {
  if (!report) return null

  const canExport = validation?.ready === true
  const message = validationMessage(validation)

  return (
    <div className="flex flex-col gap-3 bg-muted/30 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Report workflow
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <PenLine className="size-3.5 text-primary" />
            1. Build
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="flex items-center gap-1.5 font-medium">
            <FileCheck2 className="size-3.5 text-primary" />
            2. Validate
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="flex items-center gap-1.5 font-medium">
            <Download className="size-3.5 text-primary" />
            3. Download Word
          </span>
          <Badge variant={canExport ? 'success' : 'warning'}>
            {canExport
              ? 'Ready'
              : validation
                ? 'Needs attention'
                : 'Not validated'}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onValidate}
          disabled={isValidating}
        >
          <FileCheck2 className="size-4" />
          {isValidating ? 'Validating…' : 'Validate sources'}
        </Button>
        <Button
          size="sm"
          onClick={onExport}
          disabled={!canExport || isExporting}
          title={canExport ? undefined : message}
        >
          <Download className="size-4" />
          {isExporting ? 'Preparing Word…' : 'Download Word'}
        </Button>
      </div>
    </div>
  )
}

export { validationMessage }
