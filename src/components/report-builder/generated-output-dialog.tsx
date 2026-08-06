/** OPS-007 — Access the actual HTML returned by a report generation. */
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

export interface GeneratedOutputDialogProps {
  generation: ReportGeneration | null
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
          <DialogTitle>HTML export generated</DialogTitle>
          <DialogDescription>
            The generated HTML is ready to download and can be archived with
            its deterministic checksum.
          </DialogDescription>
        </DialogHeader>
        {generation ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Format</dt>
            <dd className="font-medium">HTML</dd>
            <dt className="text-muted-foreground">Generated</dt>
            <dd className="font-medium">
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(generation.generatedAt))}
            </dd>
            <dt className="text-muted-foreground">Checksum</dt>
            <dd>
              <code className="break-all text-xs">{generation.outputChecksum}</code>
            </dd>
          </dl>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            onClick={() => generation && downloadHtml(generation)}
            disabled={!hasHtml}
          >
            <Download className="size-4" /> Download HTML
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { downloadHtml }
