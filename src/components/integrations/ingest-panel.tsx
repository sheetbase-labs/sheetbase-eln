/**
 * INT-02 — scientific instrument ingestion panel.
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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import { listPublishedDatasetSchemas } from '#/lib/dataset-product'
import { listCanonicalDatasetSchemaVersionFields } from '#/lib/dataset-schema-definition-rpc'
import type { ImportTargetField } from '#/lib/import-mapping'
import { mapImportSheet, suggestImportMappings } from '#/lib/import-mapping'
import { describeConnectorsError } from '#/lib/connectors/client'
import { getParser } from '#/lib/connectors/registry'
import { ingestInstrumentPayload } from '#/lib/connectors/instrument-ingestion'
import type { InstrumentIngestionResult } from '#/lib/connectors/instrument-ingestion'
// Register built-in instrument parsers before this panel renders.
import '#/lib/connectors/plate-reader'

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
      body?.error?.message ?? 'File retention was rejected.',
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
      body?.error?.message ?? 'File retention failed during upload.',
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
  workspaceId,
  connectorId,
  parserId,
}: {
  workspaceId: string
  connectorId: string
  /** Registered ingestion parser identity on this connector. */
  parserId: string
}) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  const parser = getParser(parserId)

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
    mutationFn: async (): Promise<InstrumentIngestionResult> => {
      if (!file) throw new Error('Choose an instrument file first.')
      if (!selectedSchema) throw new Error('Choose a target Schema first.')
      if (!parser) throw new Error('No parser registered on this connector.')

      // Raw-file retention through the canonical file subsystem — before the
      // run starts, so the run's provenance references a durable object.
      const retained = await retainInstrumentFile(projectId, file)

      return ingestInstrumentPayload(dataClient, {
        workspaceId,
        connectorId,
        parserId: parser.parserId,
        text: retained.text,
        fileName: retained.fileName,
        fileRecordId: retained.fileRecordId,
        checksum: retained.checksum,
        byteSize: retained.byteSize,
        target: {
          datasetId: datasetId || null,
          expectedRevision: datasetId
            ? Number(
                (datasetsQuery.data ?? []).find((d) => d.id === datasetId)
                  ?.revision ?? 1,
              )
            : null,
          newDatasetName: datasetId ? null : newDatasetName,
          schemaVersionId: selectedSchema.schemaVersionId,
          fields: targetFields,
        },
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['connectors', connectorId, 'runs'],
      })
      void queryClient.invalidateQueries({ queryKey: ['datasets'] })
    },
  })

  async function onFilePicked(fileList: FileList | null) {
    const picked = fileList?.[0]
    if (!picked) return
    setFile(picked)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingest instrument output</CardTitle>
        <CardDescription>
          The raw file is first retained in the workspace file subsystem, then
          parsed by the registered{' '}
          <Badge variant="outline">
            {parser?.parserId}@{parser?.version}
          </Badge>{' '}
          parser, mapped to a Dataset Schema Version and committed through the
          canonical batch RPCs inside one governed run.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="ingest-file">Instrument file</Label>
          <Input
            ref={fileInputRef}
            id="ingest-file"
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            onChange={(event) => void onFilePicked(event.target.files)}
          />
        </div>

        <div className="grid gap-2">
          <Label>Retain raw file in project</Label>
          <select
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Select a project…</option>
            {(projectsQuery.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            The original bytes are retained as a file record; the run provenance
            carries its canonical fileRecordId and sha256 checksum.
          </p>
        </div>

        <div className="grid gap-2">
          <Label>Target Schema Version</Label>
          <select
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            value={schemaVersionId}
            onChange={(event) => {
              setSchemaVersionId(event.target.value)
              setDatasetId('')
            }}
          >
            <option value="">Select a published Schema…</option>
            {(schemasQuery.data ?? []).map((option) => (
              <option
                key={option.schemaVersionId}
                value={option.schemaVersionId}
              >
                {option.name} v{option.version}
              </option>
            ))}
          </select>
        </div>

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
            <div className="grid gap-2">
              <Label>Existing Dataset</Label>
              <select
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                value={datasetId}
                onChange={(event) => setDatasetId(event.target.value)}
              >
                <option value="">— Create new Dataset —</option>
                {(datasetsQuery.data ?? []).map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))}
              </select>
            </div>
            {!datasetId && (
              <div className="grid gap-2">
                <Label htmlFor="new-dataset-name">New Dataset name</Label>
                <Input
                  id="new-dataset-name"
                  value={newDatasetName}
                  onChange={(event) => setNewDatasetName(event.target.value)}
                  placeholder={`Instrument import — ${file?.name ?? 'payload'}`}
                />
              </div>
            )}
          </div>
        )}

        {mutation.error instanceof Error && (
          <Alert variant="destructive">
            <AlertTitle>Ingestion failed — recorded as a failed run</AlertTitle>
            <AlertDescription>
              {describeConnectorsError(mutation.error)}
            </AlertDescription>
          </Alert>
        )}
        {mutation.data && (
          <Alert variant="info">
            <AlertTitle>
              Run{' '}
              {mutation.data.alreadyCompleted
                ? 'already completed'
                : 'succeeded'}
            </AlertTitle>
            <AlertDescription>
              {mutation.data.rowCount} rows landed in the target Dataset via{' '}
              {mutation.data.parser.identity}, run{' '}
              <span className="font-mono">{mutation.data.runId}</span>. See run
              history below for the full provenance payload.
            </AlertDescription>
          </Alert>
        )}

        <div>
          <Button
            disabled={
              !file ||
              !selectedSchema ||
              !projectId ||
              mutation.isPending ||
              (!datasetId && !newDatasetName.trim())
            }
            onClick={() => mutation.mutate()}
          >
            <Upload className="size-4" />
            {mutation.isPending ? 'Running…' : 'Retain + ingest into Dataset'}
          </Button>
        </div>
      </CardContent>
    </Card>
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
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        Column mapping ({mappings.filter((m) => m.kind === 'field').length}{' '}
        mapped, {state.rows.length} rows)
      </p>
      <ul className="text-muted-foreground space-y-1 text-xs">
        {mappings.map((mapping) => (
          <li key={mapping.source}>
            <span className="font-mono">{mapping.source}</span> →{' '}
            {mapping.kind === 'field' ? mapping.field.label : 'ignored'}
          </li>
        ))}
      </ul>
      {previewRows.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-sm font-medium">Preview</p>
          <Table>
            <TableHeader>
              <TableRow>
                {Object.keys(previewRows[0].values).map((key) => (
                  <TableHead key={key} className="font-mono text-xs">
                    {key}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row) => (
                <TableRow key={row.rowId}>
                  {Object.keys(previewRows[0].values).map((key) => (
                    <TableCell key={key} className="font-mono text-xs">
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
