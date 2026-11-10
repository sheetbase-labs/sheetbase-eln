import { z } from 'zod'

import { t } from '#/copy'
import type { Tone } from '#/components/ui/status'
import type { DatasetImportRecord } from '#/lib/import/types'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { instrumentWarningsOf } from '#/lib/instrument-gate'
import type { InstrumentFinding } from '#/lib/instrument-gate'

export interface DatasetImportRow {
  id: string
  when: string
  file: string
  rows: number
  parser: string
  result: { tone: Tone; label: string }
  instrumentFlags: InstrumentFinding[]
  importFileId: string | null
  resumeSearch: {
    step: 'map'
    dataset: string
    experiment?: string
    parser?: string
  }
}

const retainedText = z.string().min(1).nullable().catch(null)

// Receipts can contain native numeric values as well as JSON numbers.
const retainedNumber = z
  .union([z.number(), z.nan(), z.literal(Infinity), z.literal(-Infinity)])
  .nullable()
  .catch(null)

export const INSTRUMENT_FLAG_LABELS = {
  retired: t('data.datasetImportsTab.flagRetired'),
  unqualified: t('data.datasetImportsTab.flagUnqualified'),
  calibration_overdue: t('data.datasetImportsTab.flagCalibrationOverdue'),
} satisfies Record<InstrumentFinding, string>

const RESULT_BY_STATUS = new Map<string, DatasetImportRow['result']>([
  ['committed', { tone: 'ok', label: t('data.datasetImportsTab.committed') }],
  ['failed', { tone: 'bad', label: t('common.states.failed') }],
  ['preview', { tone: 'draft', label: t('data.datasetImportsTab.preview') }],
])

/** Read only frozen receipt facts, never the mutable parser catalogue. */
export function toDatasetImportRow(
  receipt: DatasetImportRecord,
): DatasetImportRow {
  const filename = retainedText.parse(receipt.source_provenance.filename)
  const parserName = retainedText.parse(receipt.parser_provenance.name)
  const parserVersion = retainedNumber.parse(receipt.parser_provenance.version)
  const added = retainedNumber.parse(receipt.outcome.added)

  return {
    id: receipt.id,
    when: formatNotebookDateTime(receipt.created_at),
    file:
      filename ??
      (receipt.connector_run_id
        ? t('data.datasetImportsTab.connectorImport')
        : '—'),
    rows: added ?? receipt.imported_row_ids.length,
    parser:
      parserName != null
        ? `${parserName}${parserVersion === null ? '' : ` v${parserVersion}`}`
        : '—',
    result: RESULT_BY_STATUS.get(receipt.status) ?? {
      tone: 'none',
      label: receipt.status,
    },
    instrumentFlags: instrumentWarningsOf(receipt.outcome),
    importFileId: receipt.file_id,
    resumeSearch: {
      step: 'map',
      dataset: receipt.dataset_id,
      experiment: receipt.experiment_record_id ?? undefined,
      parser: retainedText.parse(receipt.parser_provenance.key) ?? undefined,
    },
  }
}
