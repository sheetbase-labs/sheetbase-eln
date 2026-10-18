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
