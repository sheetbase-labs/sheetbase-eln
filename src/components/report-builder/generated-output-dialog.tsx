/** OPS-007 — Confirm and re-download a genuine Word export and HTML audit source. */
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

export interface GeneratedOutputDialogProps {
  generation: ReportGeneration | null
  docx: Blob | null
  filename: string | null
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
  docx,
  filename,
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
          <DialogTitle>Word document ready</DialogTitle>
          <DialogDescription>
            A Word document was generated from the frozen evidence. HTML is
            retained only as an audit/source artifact.
          </DialogDescription>
        </DialogHeader>
        {generation ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Format</dt>
            <dd className="font-medium">Word (.docx)</dd>
            <dt className="text-muted-foreground">Filename</dt>
            <dd className="font-medium break-all">{filename ?? '—'}</dd>
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
            onClick={() =>
              docx && filename && downloadReportDocx(docx, filename)
            }
            disabled={!docx || !filename}
          >
            <Download className="size-4" /> Download Word
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { downloadHtml }
