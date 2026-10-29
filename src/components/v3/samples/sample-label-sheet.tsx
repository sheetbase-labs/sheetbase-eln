import { useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { describeSampleError, recordSampleLabelPrint } from '#/lib/samples'

import {
  LabelTemplatePicker,
  useLabelTemplateChoice,
} from './label-template-picker'
import { SampleLabelCard } from './sample-label-card'
import type { LabelLook, SampleLabelRecord } from './sample-label-card'
import { SampleLabelPrintStyles } from './sample-label-print'
import { t } from '#/copy'

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

export const LABEL_SHEET_LIMIT = 96

/** A sample that can be labelled and have the print recorded on it. */
export interface BatchLabelRecord extends SampleLabelRecord {
  id: string
  metadataVersion: number
}

export function SampleLabelSheet({
  records,
  host,
  template,
}: {
  records: readonly SampleLabelRecord[]
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
            template={template}
            fit={template ? 'mm' : 'natural'}
          />
        ))}
      </div>
      <SampleLabelPrintStyles />
    </div>,
    document.body,
  )
}

export interface BatchPrintOutcome {
  recorded: number
  failed: { identifier: string; error: unknown }[]
}

/**
 * Record a print on every sample in the batch. A sample whose record is refused
 * (changed by someone else, no access) is reported by identifier; the others
 * are still recorded, because the sheet has printed either way.
 */
export async function recordBatchPrints(
  client: DataClient,
  records: readonly BatchLabelRecord[],
): Promise<BatchPrintOutcome> {
  const settled = await Promise.allSettled(
    records.map((record) =>
      recordSampleLabelPrint(client, {
        recordId: record.id,
        expectedMetadataVersion: record.metadataVersion,
        identifier: record.identifier,
      }),
    ),
  )
  const failed: BatchPrintOutcome['failed'] = []
  settled.forEach((result, index) => {
    if (result.status === 'rejected')
      failed.push({
        identifier: records[index].identifier,
        error: result.reason,
      })
  })
  return { recorded: records.length - failed.length, failed }
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
  const labelChoice = useLabelTemplateChoice('sample', client)
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
            batch: batch.length,
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
              : t('library.samples.sampleLabelSheet.labelsWillGoToYour', {
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
