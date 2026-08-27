/**
 * INT-02 — scientific instrument ingestion panel.
 *
 * Proves the generic framework end-to-end for one representative instrument
 * flow: raw plate-reader CSV → registered parser identity → column mapping →
 * validate_dataset_row_batch → commit_dataset_row_batch, wrapped entirely in a
 * governed connector run with logs, attempt history and result provenance.
 */
import { useMemo, useRef, useState } from 'react'
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
import { createDataset, listPublishedDatasetSchemas } from '#/lib/dataset-product'
import {
  listCanonicalDatasetSchemaVersionFields,
} from '#/lib/dataset-schema-definition-rpc'
import type { ImportColumnMapping, ImportTargetField } from '#/lib/import-mapping'
import { mapImportSheet, suggestImportMappings } from '#/lib/import-mapping'
import { describeConnectorsError } from '#/lib/connectors/client'
import { getParser } from '#/lib/connectors/registry'
import { ingestInstrumentPayload } from '#/lib/connectors/instrument-ingestion'
import type { InstrumentIngestionResult } from '#/lib/connectors/instrument-ingestion'
// Register built-in instrument parsers before this panel renders.
import '#/lib/connectors/plate-reader'

const dataClient = createDataClient()

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
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileText, setFileText] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)

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

  // Column mapping state: source header → field id or '' (ignore).
  const parser = getParser(parserId)

  const parsed = useMemo(() => {
    if (!fileText || !parser) return null
    try {
      return parser.parse(fileText)
    } catch {
      return null
    }
  }, [fileText, parser])

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

  const mappings: ImportColumnMapping[] = useMemo(() => {
    if (!parsed) return []
    return suggestImportMappings(parsed.headers, targetFields)
  }, [parsed, targetFields])

  const previewRows = useMemo(() => {
    if (!parsed) return []
    const mapped = mapImportSheet(
      { name: fileName ?? 'data', headers: parsed.headers, rows: parsed.rows.slice(0, 5) },
      mappings,
      schemaVersionId,
    )
    return mapped.rows
  }, [parsed, mappings, schemaVersionId, fileName])

  const mutation = useMutation({
    mutationFn: async (): Promise<InstrumentIngestionResult> => {
      if (!fileText || !selectedSchema || !parser) {
        throw new Error('Choose a file and a target Schema first.')
      }
      let dataset = datasetId
        ? (
            await dataClient.list<{ id: string; revision: number | string }>(
              'datasets',
              `?id=eq.${datasetId}&select=id,name,revision`,
            )
          )[0]
        : null
      let expectedRevision = Number(dataset?.revision ?? 1)
      if (!dataset) {
        const created = await createDataset(dataClient, {
          workspaceId,
          schemaVersionId: selectedSchema.schemaVersionId,
          name:
            newDatasetName.trim() ||
            `Instrument import — ${fileName ?? 'payload'}`,
        })
        dataset = { ...created, revision: created.revision }
        expectedRevision = created.revision
      }

      return ingestInstrumentPayload(dataClient, {
        workspaceId,
        connectorId,
        parserId: parser.parserId,
        text: fileText,
        fileName: fileName ?? 'instrument-output',
        byteSize: fileSize,
        target: {
          datasetId: dataset.id,
          expectedRevision,
          schemaVersionId: selectedSchema.schemaVersionId,
          fields: targetFields,
        },
        mappings,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectorQueryKeysFor(connectorId) })
    },
  })

  async function onFilePicked(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    setFileName(file.name)
    setFileSize(file.size)
    setFileText(await file.text())
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingest instrument output</CardTitle>
        <CardDescription>
          Raw file is parsed by the registered{' '}
          <Badge variant="outline">{parser?.parserId}@{parser?.version}</Badge>{' '}
          parser, mapped to a Dataset Schema Version, then validated and
          committed through the canonical batch RPCs inside one governed run.
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
          {parsed && (
            <p className="text-muted-foreground text-xs">
              Parsed {parsed.rows.length} rows; metadata keys:{' '}
              {Object.keys(parsed.metadata).join(', ') || 'none'}
              {parsed.warnings.length > 0 &&
                `. Warnings: ${parsed.warnings.join('; ')}`}
            </p>
          )}
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
              <option key={option.schemaVersionId} value={option.schemaVersionId}>
                {option.name} v{option.version}
              </option>
            ))}
          </select>
        </div>

        {targetFields.length > 0 && parsed && (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">
              Column mapping ({mappings.filter((m) => m.kind === 'field').length}{' '}
              mapped)
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
                  placeholder={`Instrument import — ${fileName ?? 'payload'}`}
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
              Run {mutation.data.alreadyCompleted ? 'already completed' : 'succeeded'}
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
              !fileText ||
              !selectedSchema ||
              mutation.isPending ||
              (!datasetId && !newDatasetName.trim() && !fileName)
            }
            onClick={() => mutation.mutate()}
          >
            <Upload className="size-4" />
            {mutation.isPending ? 'Running…' : 'Ingest into Dataset'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function connectorQueryKeysFor(connectorId: string) {
  return [
    ['connectors', connectorId, 'runs'] as const,
    ['connectors', connectorId] as const,
    ['datasets'] as const,
  ]
}
