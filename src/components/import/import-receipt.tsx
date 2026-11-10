import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { t } from '#/copy'
import { Banner } from '#/components/ui/alert'
import { FileDrop } from '#/components/ui/file-drop'
import { PageHeader, Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { uploadImportFile } from '#/lib/import/data'
import type { DatasetImportRecord } from '#/lib/import/types'
import { safeReturnTo } from '#/lib/create-context-search'

import { carriedOverSettings, receiptPresentation } from './import-receipt-data'

/**
 * A committed import is a receipt, not a draft: what was imported, with which
 * parser and mapping, into which snapshot — read-only. The one thing it offers
 * is a corrected file, which opens a new import with the old settings.
 */
export function ImportReceipt({
  importId,
  receipt,
  returnTo,
}: {
  importId: string
  receipt: DatasetImportRecord
  returnTo?: string
}) {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  const returnPath =
    safeReturnTo(returnTo) ??
    (receipt.experiment_record_id
      ? `/experiments/${encodeURIComponent(receipt.experiment_record_id)}/notebook`
      : undefined)

  const { filename, parser, sources, worksheet, checksum, rows } =
    receiptPresentation(receipt)

  async function uploadCorrected(file: File) {
    setError('')

    try {
      const upload = await uploadImportFile({
        file,
        datasetId: receipt.dataset_id,
      })

      await navigate({
        to: '/import/$importId',
        params: { importId: upload.fileId },
        search: { ...carriedOverSettings(receipt), returnTo: returnPath },
      })
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : t('data.importReceipt.correctedFileCouldUploaded'),
      )
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        trail={[
          {
            label: t('data.importReceipt.datasets'),
            link: { to: '/datasets' },
          },
          { label: t('data.importReceipt.importReceipt') },
        ]}
        title={filename}
        meta={
          <>
            <Status tone="ok">{t('data.importReceipt.committed')}</Status>
            <span>{formatNotebookDateTime(receipt.created_at)}</span>
            <span className="mono max-lg:hidden">
              {t('data.importReceipt.importId', { id: importId.slice(0, 8) })}
            </span>
          </>
        }
      />
      <div className="grid gap-5 px-4 py-4 md:px-6">
        {returnPath ? (
          <Link to={returnPath} className="text-link">
            {t('data.importReceipt.backTo')}{' '}
            {returnPath ===
            `/experiments/${receipt.experiment_record_id}/notebook`
              ? t('data.importReceipt.theNotebook')
              : t('data.importReceipt.whereWere')}
          </Link>
        ) : null}
        <Banner tone="info" title={t('data.importReceipt.importCommitted')}>
          {t('data.importReceipt.readOnlyReceiptFile')}
        </Banner>
        {error ? (
          <Banner tone="bad" title={t('data.importReceipt.uploadError')}>
            {error}
          </Banner>
        ) : null}

        <Section title={t('data.importReceipt.receipt')}>
          <dl className="m-0 grid grid-cols-[120px_1fr] gap-y-1 text-body">
            <dt className="text-fg-muted">{t('data.importReceipt.dataset')}</dt>
            <dd className="m-0">
              <Link
                to="/datasets/$datasetId"
                params={{ datasetId: receipt.dataset_id }}
                search={{ view: 'imports' }}
                className="text-link"
              >
                {t('data.importReceipt.openDataset')}
              </Link>
            </dd>
            <dt className="text-fg-muted">{t('data.importReceipt.parser')}</dt>
            <dd className="m-0">{parser}</dd>
            <dt className="text-fg-muted">
              {t('data.importReceipt.worksheet')}
            </dt>
            <dd className="m-0">{worksheet}</dd>
            <dt className="text-fg-muted">{t('data.importReceipt.sha256')}</dt>
            <dd className="m-0 break-all font-mono text-xs">{checksum}</dd>
            <dt className="text-fg-muted">{t('data.importReceipt.rows')}</dt>
            <dd className="m-0">{rows}</dd>
            {receipt.snapshot_version_id ? (
              <>
                <dt className="text-fg-muted">
                  {t('data.importReceipt.snapshot')}
                </dt>
                <dd className="m-0">
                  <Link
                    to="/datasets/$datasetId/rows"
                    params={{ datasetId: receipt.dataset_id }}
                    search={{ snapshot: receipt.snapshot_version_id }}
                    className="text-link"
                  >
                    {receipt.snapshot_version_id.slice(0, 8)}
                  </Link>
                </dd>
              </>
            ) : null}
          </dl>
        </Section>

        {sources.length ? (
          <Section
            title={t('data.importReceipt.mappingUsed')}
            count={sources.length}
          >
            <TableBox>
              <Table aria-label={t('data.importReceipt.mappingUsed')}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="first:pl-3">
                      {t('data.importReceipt.fileColumn')}
                    </TableHead>
                    <TableHead>
                      {t('data.importReceipt.datasetField')}
                    </TableHead>
                    <TableHead>{t('data.importReceipt.sourceUnit')}</TableHead>
                    <TableHead>{t('data.importReceipt.storageUnit')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((entry) => (
                    <TableRow key={entry.source}>
                      <TableCell className="first:pl-3">
                        {entry.source}
                      </TableCell>
                      <TableCell>{entry.fieldId}</TableCell>
                      <TableCell>
                        {entry.sourceUnit ??
                          t('data.importReceipt.notDeclared')}
                      </TableCell>
                      <TableCell>{entry.unit ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          </Section>
        ) : null}

        <Section title={t('data.importReceipt.uploadCorrectedFile')}>
          <FileDrop
            label={t('data.importReceipt.correctedFile')}
            inputLabel={t('data.importReceipt.correctedFile')}
            hint={t('data.importReceipt.startsNewImportInto')}
            accept=".csv,.tsv,.tab,.txt,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onFile={(file) => (file ? uploadCorrected(file) : undefined)}
          />
        </Section>
      </div>
    </div>
  )
}
