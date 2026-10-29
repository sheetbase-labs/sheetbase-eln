import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Field, Input } from '#/components/v3/ui/input'
import { PageHeader } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { Stepper } from '#/components/v3/ui/stepper'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { createDataClient } from '#/lib/data-client'
import { createDataset } from '#/lib/dataset-product'
import {
  INFERRED_TYPES,
  columnKeyFromName,
  inferImportColumns,
} from '#/lib/import-infer'
import type { InferredColumn, InferredType } from '#/lib/import-infer'
import {
  createStructureFromFile,
  fetchImportFile,
  importQueryKeys,
} from '#/lib/import/data'
import type { ImportSheetPreview } from '#/lib/import/types'
import { t } from '#/copy'

import { serializeImportMapping } from './import-search'

const client = createDataClient()

const TYPE_LABEL: Record<InferredType, () => string> = {
  text: () => t('data.importFlow.fileColumns.typeText'),
  integer: () => t('data.importFlow.fileColumns.typeInteger'),
  decimal: () => t('data.importFlow.fileColumns.typeDecimal'),
  boolean: () => t('data.importFlow.fileColumns.typeBoolean'),
  date: () => t('data.importFlow.fileColumns.typeDate'),
  timestamp: () => t('data.importFlow.fileColumns.typeTimestamp'),
}

interface Row extends InferredColumn {
  /** The unit as typed; empty means none. */
  unitText: string
}

/** "plate3_readout.xlsx" → "plate3 readout". */
export function datasetNameFromFile(filename: string): string {
  return (
    filename
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || filename
  )
}

function columnsOf(sheet: ImportSheetPreview): InferredColumn[] {
  return sheet.columns ?? inferImportColumns(sheet.headers, sheet.sampleRows)
}

export interface FileColumnsResult {
  datasetId: string
  /** `source:fieldId` pairs for the map step, so no column has to be matched by name. */
  map: string
  /** `source:unit` pairs: the unit the file's values are in is the table's unit. */
  units: string
  sheet?: string
}

/**
 * Import, step 1b: no table fits the file, so one is made from it. Each column
 * has a name, type and unit read from the file; the person fixes what's wrong
 * and the table, the dataset on it and the pairing of file columns to fields
 * are made together, then the import goes on to its usual check.
 */
export function FileColumnsStep({
  workspaceId,
  createdByUserId,
  fileId,
  filename,
  initialSheet,
  projectId,
  onBack,
  onCreated,
}: {
  workspaceId: string
  createdByUserId: string | null
  fileId: string
  filename: string
  initialSheet: ImportSheetPreview
  /** The project the new dataset belongs to, when the import knows one. */
  projectId: string | null
  onBack: () => void
  onCreated: (result: FileColumnsResult) => Promise<void>
}) {
  const [sheetName, setSheetName] = useState(initialSheet.name)
  const sheetQuery = useQuery({
    queryKey: [...importQueryKeys.file(fileId), 'columns', sheetName],
    enabled: sheetName !== initialSheet.name,
    staleTime: Infinity,
    queryFn: () => fetchImportFile({ fileId, sheetName }),
  })
  const sheet =
    sheetName === initialSheet.name
      ? initialSheet
      : (sheetQuery.data?.sheet ?? null)

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        trail={[
          { label: t('data.importFlow.datasets'), link: { to: '/datasets' } },
          { label: t('data.importFlow.importData') },
        ]}
        title={t('data.importFlow.importData')}
        meta={t('data.importFlow.fileColumns.description')}
      />
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <Stepper
          steps={[
            t('common.actions.upload'),
            t('data.importFlow.mapColumns'),
            t('data.importFlow.reviewImport'),
          ]}
          current={1}
        />
        {initialSheet.sheetNames.length > 1 ? (
          <Field
            label={t('data.importFlow.fileColumns.worksheet')}
            className="max-w-[280px]"
          >
            <Select
              value={sheetName}
              onChange={(event) => setSheetName(event.target.value)}
            >
              {initialSheet.sheetNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {sheet ? (
          <ColumnsEditor
            key={sheet.name}
            workspaceId={workspaceId}
            createdByUserId={createdByUserId}
            filename={filename}
            sheet={sheet}
            multiSheet={initialSheet.sheetNames.length > 1}
            projectId={projectId}
            onBack={onBack}
            onCreated={onCreated}
          />
        ) : (
          <p role="status" className="m-0 text-body text-fg-muted">
            {t('data.importFlow.fileColumns.readingSheet')}
          </p>
        )}
      </div>
    </div>
  )
}

function ColumnsEditor({
  workspaceId,
  createdByUserId,
  filename,
  sheet,
  multiSheet,
  projectId,
  onBack,
  onCreated,
}: {
  workspaceId: string
  createdByUserId: string | null
  filename: string
  sheet: ImportSheetPreview
  multiSheet: boolean
  projectId: string | null
  onBack: () => void
  onCreated: (result: FileColumnsResult) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [datasetName, setDatasetName] = useState(datasetNameFromFile(filename))
  const [rows, setRows] = useState<Row[]>(() =>
    columnsOf(sheet).map((column) => ({
      ...column,
      unitText: column.unit ?? '',
    })),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const kept = rows.filter((row) => row.keep)
  const problem = useMemo(() => {
    if (!datasetName.trim()) return t('data.importFlow.fileColumns.needName')
    if (kept.length === 0) return t('data.importFlow.fileColumns.needColumn')
    if (kept.some((row) => !row.name.trim())) {
      return t('data.importFlow.fileColumns.needColumnName')
    }
    const seen = new Set<string>()
    for (const row of kept) {
      const name = row.name.trim().toLowerCase()
      if (seen.has(name)) {
        return t('data.importFlow.fileColumns.nameClash', {
          name: row.name.trim(),
        })
      }
      seen.add(name)
    }
    return null
  }, [datasetName, kept])

  function update(source: string, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row) =>
        row.source === source ? { ...row, ...patch } : row,
      ),
    )
  }

  async function create() {
    if (problem) return
    setBusy(true)
    setError(null)
    try {
      const taken = new Set<string>()
      const fields = kept.map((row) => {
        const key = columnKeyFromName(row.name, taken)
        taken.add(key)
        const numeric = row.type === 'integer' || row.type === 'decimal'
        return {
          source: row.source,
          fieldId: crypto.randomUUID(),
          key,
          label: row.name.trim(),
          logicalType: row.type,
          unit: numeric && row.unitText.trim() ? row.unitText.trim() : null,
        }
      })
      const structure = await createStructureFromFile(client, {
        workspaceId,
        name: datasetName,
        fields,
      })
      const dataset = await createDataset(client, {
        workspaceId,
        schemaVersionId: structure.schemaVersionId,
        name: datasetName,
        createdByUserId,
        primaryProjectId: projectId,
      })
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'import'] })
      await onCreated({
        datasetId: dataset.id,
        map: serializeImportMapping(
          Object.fromEntries(fields.map((f) => [f.source, f.fieldId])),
        ),
        units: serializeImportMapping(
          Object.fromEntries(
            fields
              .filter(
                (f) =>
                  f.logicalType === 'integer' || f.logicalType === 'decimal',
              )
              .map((f) => [f.source, f.unit ?? '']),
          ),
          true,
        ),
        sheet: multiSheet ? sheet.name : undefined,
      })
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : t('data.importFlow.fileColumns.failed'),
      )
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-[1040px] flex-col gap-4">
      <div className="grid items-end gap-3 sm:grid-cols-[320px_1fr]">
        <Field label={t('data.importFlow.fileColumns.datasetName')}>
          <Input
            value={datasetName}
            onChange={(event) => setDatasetName(event.target.value)}
          />
        </Field>
        <p className="m-0 text-label text-fg-muted">
          {t('data.importFlow.fileColumns.rowsAndColumns', {
            rows: sheet.rowCount,
            columns: sheet.headers.length,
          })}
        </p>
      </div>
      <TableBox>
        <Table caption={t('data.importFlow.fileColumns.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('data.importFlow.fileColumns.inFile')}</TableHead>
              <TableHead>{t('data.importFlow.fileColumns.name')}</TableHead>
              <TableHead className="min-w-[170px]">
                {t('data.importFlow.fileColumns.type')}
              </TableHead>
              <TableHead>{t('data.importFlow.fileColumns.unit')}</TableHead>
              <TableHead>{t('data.importFlow.fileColumns.examples')}</TableHead>
              <TableHead>{t('data.importFlow.fileColumns.keep')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const numeric = row.type === 'integer' || row.type === 'decimal'
              return (
                <TableRow key={row.source}>
                  <TableCell className="font-mono text-label">
                    {row.source || '—'}
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={t('data.importFlow.fileColumns.nameAria', {
                        source: row.source,
                      })}
                      value={row.name}
                      disabled={!row.keep}
                      onChange={(event) =>
                        update(row.source, { name: event.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      aria-label={t('data.importFlow.fileColumns.typeAria', {
                        source: row.source,
                      })}
                      value={row.type}
                      disabled={!row.keep}
                      onChange={(event) =>
                        update(row.source, {
                          type: event.target.value as InferredType,
                        })
                      }
                    >
                      {INFERRED_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {TYPE_LABEL[type]()}
                        </option>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>
                    {numeric ? (
                      <Input
                        aria-label={t('data.importFlow.fileColumns.unitAria', {
                          source: row.source,
                        })}
                        value={row.unitText}
                        disabled={!row.keep}
                        className="w-24"
                        onChange={(event) =>
                          update(row.source, { unitText: event.target.value })
                        }
                      />
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {row.examples.length > 0
                      ? row.examples.join(', ')
                      : t('data.importFlow.fileColumns.emptyColumn')}
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      aria-label={t('data.importFlow.fileColumns.keepAria', {
                        name: row.name || row.source,
                      })}
                      checked={row.keep}
                      onCheckedChange={(checked) =>
                        update(row.source, { keep: Boolean(checked) })
                      }
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableBox>
      <p className="m-0 max-w-[720px] text-body text-fg-muted">
        {t('data.importFlow.fileColumns.noteMadeFromFile')}
      </p>
      {error ? (
        <Banner tone="bad" title={t('data.importFlow.fileColumns.failed')}>
          {error}
        </Banner>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="quiet"
          icon="arrowLeft"
          disabled={busy}
          onClick={onBack}
        >
          {t('data.importFlow.fileColumns.back')}
        </Button>
        <Button
          variant="primary"
          disabled={busy || problem !== null}
          onClick={() => void create()}
        >
          {busy
            ? t('data.importFlow.fileColumns.creating')
            : t('data.importFlow.fileColumns.create')}
        </Button>
        {problem ? (
          <span className="text-label text-fg-muted" role="status">
            {problem}
          </span>
        ) : null}
      </div>
    </div>
  )
}
