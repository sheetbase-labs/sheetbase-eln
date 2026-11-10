import { useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { toast } from '#/components/ui/sonner'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { describeSampleError } from '#/lib/samples'

import { LabelTemplatePicker } from './label-template-picker'
import { useLabelTemplateChoice } from './use-label-template-choice'
import {
  LABEL_SHEET_LIMIT,
  batchLabelKind,
  isSample,
  recordBatchPrints,
} from './label-sheet-data'
import type { BatchLabelRecord } from './label-sheet-data'
import { SampleLabelCard } from './sample-label-card'
import type { LabelLook } from './sample-label-card'
import { SampleLabelPrintStyles } from './sample-label-print'
import { t } from '#/copy'

export type { BatchLabelRecord, BatchPrintOutcome } from './label-sheet-data'

/**
 * Batch label printing. One print document holds a label per sample, laid out
 * in a grid, and the browser's print dialog sends the whole sheet to whichever
 * printer the person chooses (DEC-10: there is no label printer to address).
 * Each label is the same `SampleLabelCard` a single print uses, so a batch
 * cannot drift from what the sample page shows.
 *
 * The document is portalled to the body so the print rule that shows only the
 * `sample-label-print` slot is not clipped by a dialog's own positioning.
 */

export function SampleLabelSheet({
  records,
  host,
  template,
}: {
  records: readonly BatchLabelRecord[]
  host?: string
  template?: LabelLook
}) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div data-slot="sample-label-print" className="hidden">
      <div className="grid grid-cols-3 gap-2">
        {records.map((record) => (
          <SampleLabelCard
            key={record.identifier}
            record={record}
            host={host}
            // A record that is not a sample has no lot or storage hold: its
            // label carries the identifier and its title.
            source={
              isSample(record)
                ? undefined
                : { sampleType: record.title ?? null }
            }
            template={
              isSample(record)
                ? template
                : { ...template, showSampleType: true }
            }
            fit={template ? 'mm' : 'natural'}
          />
        ))}
      </div>
      <SampleLabelPrintStyles />
    </div>,
    document.body,
  )
}

/** The dialog that prints a batch of labels: the sheet, then the recording. */
export function PrintLabelsDialog({
  open,
  onOpenChange,
  records,
  scope,
  client = notebookDataClient,
  onPrinted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  records: readonly BatchLabelRecord[]
  /** What the batch is, e.g. "the 12 samples shown". */
  scope: string
  client?: DataClient
  onPrinted?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const kind = batchLabelKind(records)
  const labelChoice = useLabelTemplateChoice(kind, client)
  const samplesOnly = kind === 'sample'
  const batch = records.slice(0, LABEL_SHEET_LIMIT)
  const capped = records.length > LABEL_SHEET_LIMIT

  const print = async () => {
    setBusy(true)

    try {
      // The browser dialog blocks the thread, so record first and print after.
      const outcome = await recordBatchPrints(client, batch)
      onPrinted?.()

      if (outcome.failed.length) {
        toast.error(
          t('library.samples.sampleLabelSheet.ofPrintsCouldNotBe', {
            failed: outcome.failed.length,
            batch: outcome.recorded + outcome.failed.length,
          }),
          {
            description: `${outcome.failed
              .slice(0, 3)
              .map((f) => f.identifier)
              .join(', ')}: ${describeSampleError(outcome.failed[0].error)}`,
          },
        )
      } else {
        toast(
          t('library.samples.sampleLabelSheet.labelsSentToPrint', {
            count: batch.length,
          }),
        )
      }

      window.print()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.samples.sampleLabelSheet.printLabels')}
          description={t('library.samples.sampleLabelSheet.oneLabelForEachOf', {
            scope,
          })}
        />
        <DialogBody>
          <p className="m-0 text-body">
            {batch.length === 0
              ? t('library.samples.sampleLabelSheet.thereAreNoSamplesTo')
              : samplesOnly
                ? t('library.samples.sampleLabelSheet.labelsWillGoToYour', {
                    count: batch.length,
                  })
                : t('library.bulk.labels.willGoToPrint', {
                    count: batch.length,
                  })}
          </p>
          {capped ? (
            <p className="m-0 text-label text-fg-muted">
              {t('library.samples.sampleLabelSheet.aSheetHoldsLabelsSo', {
                labelSheetLimit: LABEL_SHEET_LIMIT,
                labelSheetLimit2: LABEL_SHEET_LIMIT,
              })}
            </p>
          ) : null}
          <LabelTemplatePicker
            templates={labelChoice.templates}
            chosen={labelChoice.chosen}
            onChoose={labelChoice.choose}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={busy || batch.length === 0}
            onClick={() => void print()}
          >
            {busy
              ? t('library.samples.sampleLabelSheet.preparing')
              : t('library.samples.sampleLabelSheet.printLabels2', {
                  count: batch.length,
                })}
          </Button>
        </DialogFooter>
        {open ? (
          <SampleLabelSheet records={batch} template={labelChoice.chosen} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
