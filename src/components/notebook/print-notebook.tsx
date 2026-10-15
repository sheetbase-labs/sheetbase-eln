import { Button } from '#/components/v3/ui/button'

export function PrintNotebookButton({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="quiet"
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
  // DATA-02: the evidence package is a deterministic ZIP built server-side
  // from api.revision_evidence_package; session cookies authenticate the GET.
  if (!revisionId) return null
  return (
    <Button
      variant="quiet"
      nativeButton={false}
      render={<a href={`/api/export/revision/${revisionId}/package`} />}
    >
      Export evidence
    </Button>
  )
}
