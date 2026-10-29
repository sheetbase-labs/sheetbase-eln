/**
 * INT-02 — scientific instrument ingestion panel. UI port: app-3's v3 kit.
 *
 * Proves the generic framework end-to-end for one representative instrument
 * flow. The raw instrument file is FIRST retained through the canonical
 * DATA-03 file subsystem (upload-authorize → PUT upload → fileRecordId + sha256
 * receipt), and that retained file — not a browser-local copy — is what the
 * connector run ingests:
 *
 *   browser File → file platform upload (fileRecordId + sha256)
 *     → connector run → registered parser identity → column mapping
 *     → validate_dataset_row_batch → commit_dataset_row_batch
 *
 * Run provenance always carries a real fileRecordId and checksum for this flow.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { FileDrop } from '#/components/v3/ui/file-drop'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Select } from '#/components/v3/ui/select'
import {
  DatasetLandingLink,
  invalidateDatasetLanding,
} from '#/components/v3/integrations/dataset-landing'
import { createDataClient } from '#/lib/data-client'
import { listPublishedDatasetSchemas } from '#/lib/dataset-product'
import { listCanonicalDatasetSchemaVersionFields } from '#/lib/dataset-schema-definition-rpc'
import type { ImportTargetField } from '#/lib/import-mapping'
import { mapImportSheet, suggestImportMappings } from '#/lib/import-mapping'
import { describeConnectorsError } from '#/lib/connectors/client'
import { getParser } from '#/lib/connectors/registry'
import { postIntake, intakeQueryKeys  } from '#/lib/connectors/intake-client'
import type { IntakeResultWire } from '#/lib/connectors/intake-client'
import { rich, t } from '#/copy'
// Register built-in instrument parsers before this panel renders.
import '#/lib/connectors/plate-reader'
import '#/lib/connectors/instrument-parsers'

const dataClient = createDataClient()

interface RetainedFile {
  fileRecordId: string
  fileName: string
  byteSize: number
  checksum: string
  text: string
}

class RetentionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetentionError'
  }
}

async function retainInstrumentFile(
  projectId: string,
  file: File,
): Promise<RetainedFile> {
  // 1. Authorise through the canonical upload RPC (RLS + audit + policy).
  const authorizeRes = await fetch('/api/files/upload-authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      displayName: file.name,
      mediaType: file.type || 'application/octet-stream',
      byteSize: file.size,
    }),
  })
  if (authorizeRes.status >= 400) {
    const body = (await authorizeRes.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new RetentionError(
      body?.error?.message ??
        t('settings.integrations.ingestPanel.fileRetentionRejected'),
    )
  }
  const meta = (await authorizeRes.json()) as {
    fileRecordId: string
    uploadUrl: string
  }

  // 2. Stream the bytes to the object-storage boundary; the server computes
  //    the sha256 while streaming and returns it in the receipt.
  const uploadRes = await fetch(`/api/files/${meta.fileRecordId}/upload`, {
    method: 'PUT',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (uploadRes.status >= 400) {
    const body = (await uploadRes.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new RetentionError(
      body?.error?.message ??
        t('settings.integrations.ingestPanel.fileRetentionFailed'),
    )
  }
  const receipt = (await uploadRes.json()) as {
    checksum: string
    byteSize: string
  }

  return {
    fileRecordId: meta.fileRecordId,
    fileName: file.name,
    byteSize: Number(receipt.byteSize),
    checksum: receipt.checksum,
    text: await file.text(),
  }
}

export function IngestPanel({
  connectorId,
  parserKey,
  parserName,
}: {
  connectorId: string
  /** The key the browser-side preview looks up; webhook parsers have none. */
  parserKey: string
  /** The parser that reads this connector's files, by the name people gave it. */
  parserName: string
}) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)

  const schemasQuery = useQuery({
    queryKey: ['connectors', 'ingest', 'schemas'],
    queryFn: () => listPublishedDatasetSchemas(dataClient),
  })
  const [schemaVersionId, setSchemaVersionId] = useState<string>('')
  const selectedSchema = (schemasQuery.data ?? []).find(
    (option) => option.schemaVersionId === schemaVersionId,
  )

  const fieldsQuery = useQuery({
    queryKey: ['connectors', 'ingest', 'fields', schemaVersionId],
    queryFn: () =>
      listCanonicalDatasetSchemaVersionFields(dataClient, schemaVersionId),
    enabled: Boolean(schemaVersionId),
  })

  const datasetsQuery = useQuery({
    queryKey: ['connectors', 'ingest', 'datasets', schemaVersionId],
    queryFn: () =>
      dataClient.list<{ id: string; name: string; revision: number | string }>(
        'datasets',
        `?schema_version_id=eq.${encodeURIComponent(schemaVersionId)}&select=id,name,revision&order=created_at.desc`,
      ),
    enabled: Boolean(schemaVersionId),
  })
  const [datasetId, setDatasetId] = useState<string>('')
  const [newDatasetName, setNewDatasetName] = useState('')

  // Raw-file retention is a first-class product guarantee: the file is stored
  // in the project's file records, so a project is required.
  const projectsQuery = useQuery({
    queryKey: ['connectors', 'ingest', 'projects'],
    queryFn: () =>
      dataClient.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title&order=title.asc',
      ),
  })
  const [projectId, setProjectId] = useState<string>('')

  const parser = getParser(parserKey)

  const targetFields: ImportTargetField[] = useMemo(
    () =>
      (fieldsQuery.data ?? [])
        .filter((field) => field.lifecycle === 'active')
        .map((field) => ({
          id: field.field_id,
          key: field.key,
          label: field.label,
          logicalType: field.logical_type,
          nullable: field.nullable,
          kind: 'dataset-field',
        })),
    [fieldsQuery.data],
  )

  const mutation = useMutation({
    mutationFn: async (): Promise<IntakeResultWire> => {
      if (!file)
        throw new Error(
          t('settings.integrations.ingestPanel.chooseInstrumentFile'),
        )
      if (!selectedSchema)
        throw new Error(
          t('settings.integrations.ingestPanel.chooseTargetSchema'),
        )

      // The original is kept first, so a file that can't be read stays on
      // record and can be tried again from the list of problems.
      const retained = await retainInstrumentFile(projectId, file)
      return postIntake({
        kind: 'upload',
        connectorId,
        fileRecordId: retained.fileRecordId,
        fileName: retained.fileName,
        projectId,
        schemaVersionId: selectedSchema.schemaVersionId,
        datasetId: datasetId || null,
        newDatasetName: datasetId ? null : newDatasetName,
      })
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: ['connectors', connectorId, 'runs'],
      })
      invalidateDatasetLanding(queryClient, result.datasetId)
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: intakeQueryKeys.all }),
  })

  return (
    <Section
      title={t('settings.integrations.ingestPanel.ingestInstrumentOutput')}
    >
      <p className="m-0 max-w-3xl text-body text-fg-muted">
        {rich('settings.integrations.ingestPanel.rawFileRetained', {
          parser: <Badge variant="kind">{parserName}</Badge>,
        })}
      </p>

      <div className="flex flex-col gap-4">
        {/* The pick is only the selection: the bytes are retained when the run
            starts, so this row says "Selected" and the run reports on itself. */}
        <FileDrop
          label={t('settings.integrations.ingestPanel.instrumentFile')}
          inputLabel={t('settings.integrations.ingestPanel.instrumentFile')}
          hint={t('settings.integrations.ingestPanel.originalFileKeptHint')}
          accept=".csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,application/json"
          disabled={mutation.isPending}
          onFile={(picked) => setFile(picked)}
        />

        <Field
          label={t('settings.integrations.ingestPanel.keepOriginalFile')}
          hint={t('settings.integrations.ingestPanel.originalFileKeptHint2')}
        >
          <Select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">
              {t('settings.integrations.ingestPanel.selectProject')}
            </option>
            {(projectsQuery.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t('settings.integrations.ingestPanel.targetSchemaVersion')}
        >
          <Select
            value={schemaVersionId}
            onChange={(event) => {
              setSchemaVersionId(event.target.value)
              setDatasetId('')
            }}
          >
            <option value="">
              {t('settings.integrations.ingestPanel.selectPublishedSchema')}
            </option>
            {(schemasQuery.data ?? []).map((option) => (
              <option
                key={option.schemaVersionId}
                value={option.schemaVersionId}
              >
                {option.name} v{option.version}
              </option>
            ))}
          </Select>
        </Field>

        {targetFields.length > 0 && file && parser && (
          <MappingPreview
            file={file}
            parser={parser}
            targetFields={targetFields}
            schemaVersionId={schemaVersionId}
          />
        )}

        {schemaVersionId && (
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('settings.integrations.ingestPanel.existingDataset')}
            >
              <Select
                value={datasetId}
                onChange={(event) => setDatasetId(event.target.value)}
              >
                <option value="">
                  {t('settings.integrations.ingestPanel.createNewDataset')}
                </option>
                {(datasetsQuery.data ?? []).map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))}
              </Select>
            </Field>
            {!datasetId && (
              <Field
                label={t('settings.integrations.ingestPanel.newDatasetName')}
              >
                <Input
                  value={newDatasetName}
                  onChange={(event) => setNewDatasetName(event.target.value)}
                  placeholder={t(
                    'settings.integrations.ingestPanel.instrumentImportPlaceholder',
                    {
                      name:
                        file?.name ??
                        t('settings.integrations.ingestPanel.payload'),
                    },
                  )}
                />
              </Field>
            )}
          </div>
        )}

        {mutation.error instanceof Error && (
          <Notice
            tone="bad"
            title={t(
              'settings.integrations.ingestPanel.ingestionFailedRecorded',
            )}
          >
            {describeConnectorsError(mutation.error)}
          </Notice>
        )}
        {mutation.data && (
          <Notice tone="info">
            <span className="font-semibold">
              {mutation.data.alreadyCompleted
                ? t('settings.integrations.ingestPanel.runAlreadyCompleted')
                : t('settings.integrations.ingestPanel.runSucceeded')}
            </span>
            <p className="m-0">
              {rich('settings.integrations.ingestPanel.rowsLandedVia', {
                count: mutation.data.rowCount,
                identity: mutation.data.parser,
              })}
            </p>
            <p className="m-0">
              <DatasetLandingLink datasetId={mutation.data.datasetId} />
            </p>
          </Notice>
        )}

        <div>
          <Button
            variant="primary"
            icon="upload"
            disabled={
              !file ||
              !selectedSchema ||
              !projectId ||
              mutation.isPending ||
              (!datasetId && !newDatasetName.trim())
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? t('settings.integrations.ingestPanel.running')
              : t('settings.integrations.ingestPanel.retainIngestInto')}
          </Button>
        </div>
      </div>
    </Section>
  )
}

/** Mapping table + preview rendered from the actual retained payload. */
function MappingPreview({
  file,
  parser,
  targetFields,
  schemaVersionId,
}: {
  file: File
  parser: NonNullable<ReturnType<typeof getParser>>
  targetFields: ImportTargetField[]
  schemaVersionId: string
}) {
  const [state, setState] = useState<{
    headers: string[]
    rows: Array<Record<string, string>>
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void file.text().then((text) => {
      if (cancelled) return
      try {
        const parsed = parser.parse(text)
        setState({ headers: parsed.headers, rows: parsed.rows })
      } catch {
        setState({ headers: [], rows: [] })
      }
    })
    return () => {
      cancelled = true
    }
  }, [file, parser])

  const mappings = useMemo(() => {
    if (!state) return []
    return suggestImportMappings(state.headers, targetFields)
  }, [state, targetFields])

  const previewRows = useMemo(() => {
    if (!state) return []
    const mapped = mapImportSheet(
      {
        name: file.name,
        headers: state.headers,
        rows: state.rows.slice(0, 5),
      },
      mappings,
      schemaVersionId,
    )
    return mapped.rows
  }, [state, mappings, schemaVersionId, file.name])

  if (!state) return null
  if (mappings.length === 0) return null

  return (
    <div className="rounded-md border border-border p-3">
      <p className="m-0 mb-2 text-body font-medium">
        {t('settings.integrations.ingestPanel.columnMappingMapped', {
          length: mappings.filter((m) => m.kind === 'field').length,
          length2: state.rows.length,
        })}
      </p>
      <ul className="m-0 list-none space-y-1 p-0 text-label text-fg-muted">
        {mappings.map((mapping) => (
          <li key={mapping.source}>
            <span className="mono">{mapping.source}</span> →{' '}
            {mapping.kind === 'field' ? mapping.field.label : 'ignored'}
          </li>
        ))}
      </ul>
      {previewRows.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-body font-medium">
            {t('settings.integrations.ingestPanel.preview')}
          </p>
          <Table
            aria-label={t(
              'settings.integrations.ingestPanel.mappingPreviewAria',
            )}
          >
            <TableHeader>
              <TableRow>
                {Object.keys(previewRows[0].values).map((key) => (
                  <TableHead key={key} className="mono text-label">
                    {key}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row) => (
                <TableRow key={row.rowId}>
                  {Object.keys(previewRows[0].values).map((key) => (
                    <TableCell key={key} className="mono text-label">
                      {row.values[key] === null || row.values[key] === undefined
                        ? ''
                        : String(row.values[key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  )
}
