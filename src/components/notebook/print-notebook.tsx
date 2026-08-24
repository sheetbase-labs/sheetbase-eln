import { useMutation } from '@tanstack/react-query'

import { Button } from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import { downloadRevisionEvidence } from '#/lib/notebook-experience'
import { sign002DataClient } from '#/lib/sign-002'

export function PrintNotebookButton({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      data-print-hide
      onClick={() => window.print()}
    >
      Print
    </Button>
  )
}

export function NotebookPrintStyles() {
  return (
    <style>{`
@media print {
  @page {
    margin: 16mm;
  }
  [data-slot="sidebar"],
  [data-slot="inspector"],
  [data-print-hide],
  button[data-print-hide],
  [data-slot="block-toolbar"] {
    display: none !important;
  }
  body {
    background: white;
  }
  img, svg, canvas {
    break-inside: avoid;
  }
}
`}</style>
  )
}

export function ExportEvidenceButton({
  revisionId,
}: {
  revisionId?: string | null
}) {
  const exportEvidence = useMutation({
    mutationFn: async () => {
      if (!revisionId) {
        throw new DataClientError(
          'validation_error',
          'No submitted revision is selected.',
          400,
        )
      }
      const bundle = await downloadRevisionEvidence(
        sign002DataClient,
        revisionId,
      )
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `evidence-${revisionId.slice(0, 8)}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      return bundle
    },
  })

  if (!revisionId) return null

  const errorMessage =
    exportEvidence.error instanceof DataClientError
      ? exportEvidence.error.message
      : exportEvidence.error instanceof Error
        ? exportEvidence.error.message
        : null

  return (
    <span className="inline-flex flex-col items-start gap-1" data-print-hide>
      <Button
        type="button"
        variant="outline"
        disabled={exportEvidence.isPending}
        onClick={() => exportEvidence.mutate()}
      >
        Download evidence
      </Button>
      {errorMessage ? (
        <span className="text-xs text-destructive" role="alert">
          {errorMessage}
        </span>
      ) : null}
    </span>
  )
}
