import { z } from 'zod'

import { t } from '#/copy'
import type { DatasetImportRecord } from '#/lib/import/types'
import { serializeImportMapping } from './import-search'
import type { ImportSearch } from './import-search'

const retainedText = z.string().min(1).optional().catch(undefined)

// Frozen receipts retain native numbers, including non-finite historical values.
const retainedNumber = z
  .union([z.number(), z.nan(), z.literal(Infinity), z.literal(-Infinity)])
  .optional()
  .catch(undefined)

const OUTCOME_LABELS = Object.fromEntries([
  ['added', t('data.importReceipt.added')],
  ['planned', t('data.importReceipt.planned')],
  ['new', t('common.actions.new')],
  ['flagged', t('data.importReceipt.flagged')],
  ['skipped', t('data.importReceipt.skipped')],
])

/** A failed or preview row is not a receipt; the file remains open to mapping. */
export function findCommittedReceipt(
  receipts: readonly DatasetImportRecord[] | undefined,
  fileId: string,
  sheetName?: string,
): DatasetImportRecord | null {
  return (
    receipts?.find(
      (receipt) =>
        receipt.status === 'committed' &&
        receipt.file_id === fileId &&
        (!sheetName || receipt.mapping?.sheetName === sheetName),
    ) ?? null
  )
}

/** Corrected files reuse the frozen settings but must be checked again. */
export function carriedOverSettings(
  receipt: DatasetImportRecord,
): ImportSearch {
  const values: Record<string, string> = {}

  for (const entry of receipt.mapping?.sources ?? []) {
    if (entry.fieldId) values[entry.source] = entry.fieldId
  }

  const map = serializeImportMapping(values)

  const units = serializeImportMapping(
    Object.fromEntries(
      (receipt.mapping?.sources ?? []).flatMap((entry) =>
        entry.sourceUnit ? [[entry.source, entry.sourceUnit]] : [],
      ),
    ),
  )

  return {
    step: 'map',
    dataset: receipt.dataset_id,
    experiment: receipt.experiment_record_id ?? undefined,
    instrument: receipt.instrument_id ?? undefined,
    parser: retainedText.parse(receipt.parser_provenance.key),
    map: map || undefined,
    units: units || undefined,
    sheet: receipt.mapping?.sheetName,
  }
}

/** Read the retained receipt, not mutable parser or dataset catalogue facts. */
export function receiptPresentation(receipt: DatasetImportRecord) {
  const parserName = retainedText.parse(receipt.parser_provenance.name)
  const parserVersion = retainedNumber.parse(receipt.parser_provenance.version)

  const outcome = Object.entries(receipt.outcome).flatMap(([key, value]) => {
    const count = retainedNumber.parse(value)

    return count === undefined ? [] : [[key, count] as const]
  })

  return {
    filename:
      retainedText.parse(receipt.source_provenance.filename) ??
      t('data.importReceipt.importedFile'),
    parser: parserName
      ? `${parserName}${parserVersion === undefined ? '' : ` v${parserVersion}`}`
      : t('data.importReceipt.mappedHand'),
    worksheet:
      retainedText.parse(receipt.source_provenance.sheetName) ??
      receipt.mapping?.sheetName ??
      t('data.importReceipt.notRecorded'),
    checksum:
      retainedText.parse(receipt.source_provenance.checksum) ??
      t('data.importReceipt.notRecorded'),
    rows: outcome.length
      ? outcome
          .map(([key, count]) =>
            `${count} ${OUTCOME_LABELS[key] ?? key}`.toLowerCase(),
          )
          .join(' · ')
      : `${receipt.imported_row_ids.length} imported`,
    sources: (receipt.mapping?.sources ?? []).filter((entry) => entry.fieldId),
  }
}
