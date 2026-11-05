import { LabLogo, useLabLogoVersion } from '#/components/ui/lab-logo'

/**
 * The lab's name and logo at the head of a printed page. It is hidden on
 * screen, and absent until the lab has uploaded a logo.
 */
export function LabPrintHeader({ workspaceName }: { workspaceName?: string }) {
  const version = useLabLogoVersion()
  if (!version) return null
  return (
    <div
      data-print-only
      className="mb-4 hidden items-center gap-3 border-b border-border pb-3 print:flex"
    >
      <LabLogo height={36} fallback="none" />
      {workspaceName ? (
        <span className="text-body font-medium">{workspaceName}</span>
      ) : null}
    </div>
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
