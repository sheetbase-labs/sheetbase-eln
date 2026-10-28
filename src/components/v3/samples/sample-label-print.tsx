import { useMutation } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { toast } from '#/components/v3/ui/sonner'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { describeSampleError, recordSampleLabelPrint } from '#/lib/samples'

import { SampleLabelCard } from './sample-label-card'
import type { LabelLook, SampleLabelRecord } from './sample-label-card'

/**
 * LAB-05.2 — browser print of a sample label (DEC-10).
 *
 * The lab has no specific printers, so there is no gateway to hand a job to and
 * nothing to confirm one against: `SampleLabelPrint` renders the label as a
 * print document in the page and `Window.print()` sends that document to
 * whatever printer the person chooses in the browser dialog.
 *
 * The document is the LAB-05.1 label — the DEC-10 code, the identifier, the lot
 * and the storage condition with its use-by — rendered by the same
 * `SampleLabelCard` the inspector previews, so what prints cannot drift from
 * what the person sees. `SampleLabelPrintStyles` prints that document alone.
 *
 * The print is recorded on the sample through the existing sample-event path
 * (see `recordSampleLabelPrint`); the toast reports the print without naming a
 * printer that does not exist.
 */

/** The facts the print action needs to record the print on the sample. */
export interface SamplePrintTarget {
  id: string
  identifier: string
  metadataVersion: number
}

/** The print document: the label template, hidden on screen, printed alone. */
export function SampleLabelPrint({
  record,
  host,
  template,
}: {
  record: SampleLabelRecord
  /** The host a scanned code resolves against; defaults to the current origin. */
  host?: string
  /** The label template chosen to print with; its size becomes the page. */
  template?: LabelLook
}) {
  return (
    <div data-slot="sample-label-print" className="hidden">
      <SampleLabelCard
        record={record}
        host={host}
        template={template}
        fit={template ? 'mm' : 'natural'}
      />
      <SampleLabelPrintStyles
        widthMm={template?.widthMm}
        heightMm={template?.heightMm}
      />
    </div>
  )
}

export function SampleLabelPrintStyles({
  widthMm,
  heightMm,
}: {
  widthMm?: number
  heightMm?: number
} = {}) {
  // A chosen template prints on a page of its own size; without one the label
  // sits on the default sheet.
  const page =
    widthMm && heightMm
      ? `size: ${widthMm}mm ${heightMm}mm;\n    margin: 0;`
      : 'margin: 12mm;'
  return (
    <style>{`
@media print {
  @page {
    ${page}
  }
  /* The label document is the only thing on the sheet. Hiding visibility rather
     than display leaves the document's own layout intact while every other
     element on the page — the page chrome, the tabs and the label preview —
     disappears from the printout. */
  body * {
    visibility: hidden;
  }
  [data-slot="sample-label-print"],
  [data-slot="sample-label-print"] * {
    visibility: visible;
  }
  [data-slot="sample-label-print"] {
    display: block !important;
    position: absolute;
    top: 0;
    left: 0;
  }
}
`}</style>
  )
}

/**
 * The design's "Print label" action. It asks the browser to print the label
 * document and records the print on the sample through the existing
 * sample-event path, so the History tab shows it. A refusal from that path is
 * surfaced as a toast rather than an unhandled error.
 */
export function PrintLabelButton({
  record,
  client = notebookDataClient,
  onPrinted,
  className,
}: {
  record: SamplePrintTarget
  /** Overridable for tests; the page uses the shared notebook data client. */
  client?: DataClient
  /** Called after the print is recorded, so the caller can refresh the sample. */
  onPrinted?: () => void
  className?: string
}) {
  const recordPrint = useMutation({
    mutationFn: () =>
      recordSampleLabelPrint(client, {
        recordId: record.id,
        expectedMetadataVersion: record.metadataVersion,
        identifier: record.identifier,
      }),
    onSuccess: () => {
      onPrinted?.()
      toast('Label sent to print')
    },
    onError: (error) => toast.error(describeSampleError(error)),
  })

  return (
    <Button
      type="button"
      className={className}
      disabled={recordPrint.isPending}
      data-print-hide
      onClick={() => {
        // Fire the recording first: the browser dialog blocks the thread, and
        // DEC-10 has no gateway to confirm the job afterwards.
        recordPrint.mutate()
        window.print()
      }}
    >
      Print label
    </Button>
  )
}
