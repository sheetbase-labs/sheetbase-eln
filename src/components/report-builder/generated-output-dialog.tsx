/** OPS-007 — Confirm and re-download frozen PDF, Word, and HTML exports. */
import { Download } from 'lucide-react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui'
import type { ReportGeneration } from '#/lib/report-builder'
import { downloadReportDocx } from '#/lib/report-builder-docx'
import { downloadReportPdf } from '#/lib/report-builder-pdf'

export interface GeneratedOutputDialogProps {
  generation: ReportGeneration | null
  pdf: Blob | null
  docx: Blob | null
  pdfFilename: string | null
  docxFilename: string | null
  onClose: () => void
}

function downloadHtml(generation: ReportGeneration) {
  if (!generation.outputHtml) return
  const blob = new Blob([generation.outputHtml], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `report-${generation.id}.html`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function GeneratedOutputDialog({
  generation,
  pdf,
  docx,
  pdfFilename,
  docxFilename,
  onClose,
}: GeneratedOutputDialogProps) {
  const hasHtml = Boolean(generation?.outputHtml)

  return (
    <Dialog
      open={Boolean(generation)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>PDF document ready</DialogTitle>
          <DialogDescription>
            A PDF document was generated from frozen evidence. Word and HTML
            remain secondary export and audit/source artifacts.
          </DialogDescription>
        </DialogHeader>
        {generation ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Format</dt>
            <dd className="font-medium">PDF (.pdf)</dd>
            <dt className="text-muted-foreground">Filename</dt>
            <dd className="font-medium break-all">{pdfFilename ?? '—'}</dd>
            <dt className="text-muted-foreground">Generated</dt>
            <dd className="font-medium">
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(generation.generatedAt))}
            </dd>
            <dt className="text-muted-foreground">Checksum</dt>
            <dd>
              <code className="break-all text-xs">
                {generation.outputChecksum}
              </code>
            </dd>
          </dl>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => generation && downloadHtml(generation)}
            disabled={!hasHtml}
          >
            Download HTML source
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              docx && docxFilename && downloadReportDocx(docx, docxFilename)
            }
            disabled={!docx || !docxFilename}
          >
            Download Word
          </Button>
          <Button
            type="button"
            onClick={() =>
              pdf && pdfFilename && downloadReportPdf(pdf, pdfFilename)
            }
            disabled={!pdf || !pdfFilename}
          >
            <Download className="size-4" /> Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { downloadHtml }
