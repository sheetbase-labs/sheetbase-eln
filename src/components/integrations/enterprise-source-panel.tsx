/**
 * INT-03 — enterprise connector source panel (S3 / PostgreSQL).
 *
 * Dense product surface for importing from enterprise sources through the
 * connector framework. All external access happens server-side via
 * /api/connectors/source; this panel only renders bounded metadata,
 * previews and import receipts. Imports land in Datasets through the same
 * governed run model as instrument ingestion (run history shows attempts,
 * stage logs and provenance).
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw } from 'lucide-react'

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
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import {
  discoverConnectorSource,
  importConnectorSource,
  previewConnectorSource,
  testConnectorConnection,
} from '#/lib/connectors/enterprise/client'
import type {
  PostgresDiscoveryResult,
  PreviewResult,
  S3DiscoveryPage,
} from '#/lib/connectors/enterprise/types'
import { enterpriseAdapterId } from '#/lib/connectors/enterprise/types'
import type { ConnectorWire } from '#/lib/connectors/types'
import { suggestImportMappings } from '#/lib/import-mapping'
import type { ImportTargetField } from '#/lib/import-mapping'
import { listPublishedDatasetSchemas } from '#/lib/dataset-product'
import { listCanonicalDatasetSchemaVersionFields } from '#/lib/dataset-schema-definition-rpc'

const dataClient = createDataClient()

export function EnterpriseSourcePanel({
  workspaceId,
  connector,
}: {
  workspaceId: string
  connector: ConnectorWire
}) {
  const adapterId = enterpriseAdapterId(connector)
  if (!adapterId) return null
  return adapterId === 's3' ? (
    <S3SourcePanel workspaceId={workspaceId} connector={connector} />
  ) : (
    <PostgresSourcePanel workspaceId={workspaceId} connector={connector} />
  )
}

// ---------------------------------------------------------------------------
// Shared: target Schema Version + Dataset picker, mapping suggestions.
// ---------------------------------------------------------------------------
interface TargetState {
  schemaVersionId: string
  datasetId: string
  newDatasetName: string
}

function useTargetFields(schemaVersionId: string) {
  const fieldsQuery = useQuery({
    queryKey: ['connectors', 'source', 'fields', schemaVersionId],
    queryFn: () =>
      listCanonicalDatasetSchemaVersionFields(dataClient, schemaVersionId),
    enabled: Boolean(schemaVersionId),
  })
  const fields: ImportTargetField[] = useMemo(
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
  return fields
}

function TargetControls({
  state,
  onChange,
}: {
  state: TargetState
  onChange: (next: TargetState) => void
}) {
  const schemasQuery = useQuery({
    queryKey: ['connectors', 'source', 'schemas'],
    queryFn: () => listPublishedDatasetSchemas(dataClient),
  })
  const datasetsQuery = useQuery({
    queryKey: ['connectors', 'source', 'datasets', state.schemaVersionId],
    queryFn: () =>
      dataClient.list<{ id: string; name: string; revision: number | string }>(
        'datasets',
        `?schema_version_id=eq.${encodeURIComponent(state.schemaVersionId)}&select=id,name,revision&order=created_at.desc`,
      ),
    enabled: Boolean(state.schemaVersionId),
  })
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label>Target Schema Version</Label>
        <Select
          value={state.schemaVersionId}
          onChange={(event) =>
            onChange({
              schemaVersionId: event.target.value,
              datasetId: '',
              newDatasetName: state.newDatasetName,
            })
          }
        >
          <option value="">Select a published Schema…</option>
          {(schemasQuery.data ?? []).map((option) => (
            <option key={option.schemaVersionId} value={option.schemaVersionId}>
              {option.name} v{option.version}
            </option>
          ))}
        </Select>
      </div>
      {state.schemaVersionId && (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Existing Dataset</Label>
            <Select
              value={state.datasetId}
              onChange={(event) =>
                onChange({ ...state, datasetId: event.target.value })
              }
            >
              <option value="">— Create new Dataset —</option>
              {(datasetsQuery.data ?? []).map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </Select>
          </div>
          {!state.datasetId && (
            <div className="grid gap-2">
              <Label>New Dataset name</Label>
              <Input
                value={state.newDatasetName}
                onChange={(event) =>
                  onChange({ ...state, newDatasetName: event.target.value })
                }
                placeholder="Import — source data"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function targetReady(state: TargetState): boolean {
  return Boolean(
    state.schemaVersionId && (state.datasetId || state.newDatasetName.trim()),
  )
}

function buildTarget(
  state: TargetState,
  fields: ImportTargetField[],
  revision: number | null,
) {
  return {
    datasetId: state.datasetId || null,
    expectedRevision: revision,
    newDatasetName: state.datasetId ? null : state.newDatasetName,
    schemaVersionId: state.schemaVersionId,
    fields,
  }
}

function MappingSummary({
  headers,
  fields,
}: {
  headers: string[]
  fields: ImportTargetField[]
}) {
  const mappings = suggestImportMappings(headers, fields)
  const mapped = mappings.filter((mapping) => mapping.kind === 'field')
  if (headers.length === 0) return null
  return (
    <ul className="text-muted-foreground space-y-0.5 text-xs">
      {mappings.map((mapping) => (
        <li key={mapping.source} className="font-mono">
          {mapping.source} →{' '}
          {mapping.kind === 'field' ? mapping.field.label : 'ignored'}
        </li>
      ))}
      {mapped.length === 0 && (
        <li className="text-destructive">No columns map to Schema fields.</li>
      )}
    </ul>
  )
}

function PreviewTable({ preview }: { preview: PreviewResult }) {
  if (preview.columns.length === 0) return null
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {preview.columns.map((column) => (
            <TableHead key={column} className="font-mono text-xs">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {preview.rows.map((row, index) => (
          <TableRow key={index}>
            {preview.columns.map((column) => (
              <TableCell key={column} className="font-mono text-xs">
                {row[column] ?? ''}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ImportButton({
  disabled,
  pending,
  onClick,
}: {
  disabled: boolean
  pending: boolean
  onClick: () => void
}) {
  return (
    <div>
      <Button size="sm" disabled={disabled} onClick={onClick}>
        <Download className="size-4" />
        {pending ? 'Importing…' : 'Import into Dataset'}
      </Button>
    </div>
  )
}

function ImportFeedback({
  error,
  receipt,
}: {
  error: unknown
  receipt:
    | {
        runId: string
        attempt: number
        alreadyCompleted: boolean
        rowCount: number
        datasetId: string
      }
    | undefined
}) {
  return (
    <>
      {error instanceof Error && (
        <Alert variant="destructive">
          <AlertTitle>Import failed — recorded as a failed run</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      {receipt && (
        <Alert variant="info">
          <AlertTitle>
            Run {receipt.alreadyCompleted ? 'already completed' : 'succeeded'} (
            attempt #{receipt.attempt})
          </AlertTitle>
          <AlertDescription>
            {receipt.rowCount} rows landed in Dataset{' '}
            <span className="font-mono">{receipt.datasetId}</span>, run{' '}
            <span className="font-mono">{receipt.runId}</span>. Provenance is
            attached to the run below.
          </AlertDescription>
        </Alert>
      )}
    </>
  )
}

function TestConnectionButton({
  workspaceId,
  connectorId,
}: {
  workspaceId: string
  connectorId: string
}) {
  const mutation = useMutation({
    mutationFn: () => testConnectorConnection({ workspaceId, connectorId }),
  })
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        <RefreshCw className="size-4" />
        {mutation.isPending ? 'Testing…' : 'Test connection'}
      </Button>
      {mutation.data && <Badge variant="default">ok</Badge>}
      {mutation.error instanceof Error && (
        <span role="alert" className="text-destructive text-xs">
          {mutation.error.message}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// S3-compatible source.
// ---------------------------------------------------------------------------
function S3SourcePanel({
  workspaceId,
  connector,
}: {
  workspaceId: string
  connector: ConnectorWire
}) {
  const queryClient = useQueryClient()
  const [objects, setObjects] = useState<S3DiscoveryPage['objects']>([])
  const [continuationToken, setContinuationToken] = useState<string | null>(
    null,
  )
  const [selectedKey, setSelectedKey] = useState('')
  const [target, setTarget] = useState<TargetState>({
    schemaVersionId: '',
    datasetId: '',
    newDatasetName: '',
  })
  const fields = useTargetFields(target.schemaVersionId)

  const projectsQuery = useQuery({
    queryKey: ['connectors', 'source', 'projects'],
    queryFn: () =>
      dataClient.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title&order=title.asc',
      ),
  })
  const [projectId, setProjectId] = useState('')

  const discoverMutation = useMutation({
    mutationFn: (token: string | null) =>
      discoverConnectorSource({
        workspaceId,
        connectorId: connector.id,
        query: { continuationToken: token ?? undefined, maxKeys: 25 },
      }) as Promise<S3DiscoveryPage>,
    onSuccess: (page) => {
      setObjects((current) => [...current, ...page.objects])
      setContinuationToken(page.continuationToken)
    },
  })

  const previewMutation = useMutation({
    mutationFn: () =>
      previewConnectorSource({
        workspaceId,
        connectorId: connector.id,
        selector: { key: selectedKey },
      }),
  })

  const importMutation = useMutation({
    mutationFn: () =>
      importConnectorSource({
        workspaceId,
        connectorId: connector.id,
        source: { key: selectedKey },
        projectId: projectId || null,
        target: buildTarget(target, fields, null),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['connectors', connector.id, 'runs'],
      })
      void queryClient.invalidateQueries({ queryKey: ['datasets'] })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Source — object storage</CardTitle>
        <CardDescription>
          Discover objects under the configured bucket/prefix, preview one and
          import it. The raw object is retained in the file platform before the
          run; imports go through canonical Dataset validation.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <TestConnectionButton
          workspaceId={workspaceId}
          connectorId={connector.id}
        />

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={discoverMutation.isPending}
            onClick={() => {
              discoverMutation.mutate(null)
            }}
          >
            List objects
          </Button>
          {continuationToken && (
            <Button
              size="sm"
              variant="ghost"
              disabled={discoverMutation.isPending}
              onClick={() => discoverMutation.mutate(continuationToken)}
            >
              Load more
            </Button>
          )}
          {discoverMutation.error instanceof Error && (
            <span role="alert" className="text-destructive text-xs">
              {discoverMutation.error.message}
            </span>
          )}
        </div>

        {objects.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Modified</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {objects.map((object) => (
                <TableRow key={object.key}>
                  <TableCell className="font-mono text-xs">
                    {object.key}
                  </TableCell>
                  <TableCell className="text-xs">{object.byteSize}</TableCell>
                  <TableCell className="text-xs">
                    {object.lastModified
                      ? new Date(object.lastModified).toLocaleString()
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={selectedKey === object.key ? 'default' : 'ghost'}
                      onClick={() => {
                        setSelectedKey(object.key)
                        setObjects((current) => current)
                        previewMutation.mutate()
                      }}
                    >
                      Select
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {selectedKey && (
          <div className="grid gap-3">
            <p className="text-muted-foreground text-xs">
              Selected <span className="font-mono">{selectedKey}</span>
            </p>
            {previewMutation.data && (
              <div className="grid gap-2">
                <MappingSummary
                  headers={previewMutation.data.columns}
                  fields={fields}
                />
                <PreviewTable preview={previewMutation.data} />
              </div>
            )}
            <div className="grid gap-2">
              <Label>Retain raw object in project</Label>
              <Select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">Select a project…</option>
                {(projectsQuery.data ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </Select>
            </div>
            <TargetControls state={target} onChange={setTarget} />
            <ImportButton
              disabled={
                !targetReady(target) ||
                !projectId ||
                fields.length === 0 ||
                importMutation.isPending
              }
              pending={importMutation.isPending}
              onClick={() => importMutation.mutate()}
            />
          </div>
        )}
        <ImportFeedback
          error={importMutation.error}
          receipt={importMutation.data}
        />
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// External PostgreSQL source (read-only).
// ---------------------------------------------------------------------------
function PostgresSourcePanel({
  workspaceId,
  connector,
}: {
  workspaceId: string
  connector: ConnectorWire
}) {
  const queryClient = useQueryClient()
  const [schema, setSchema] = useState('')
  const [selectedTable, setSelectedTable] = useState('')
  const [target, setTarget] = useState<TargetState>({
    schemaVersionId: '',
    datasetId: '',
    newDatasetName: '',
  })
  const fields = useTargetFields(target.schemaVersionId)

  const discoverMutation = useMutation({
    mutationFn: (querySchema: string) =>
      discoverConnectorSource({
        workspaceId,
        connectorId: connector.id,
        query: { schema: querySchema || undefined },
      }) as Promise<PostgresDiscoveryResult>,
  })

  const discovery = discoverMutation.data
  const selectedTableDescriptor = discovery?.tables.find(
    (table) => table.name === selectedTable,
  )

  const previewMutation = useMutation({
    mutationFn: () =>
      previewConnectorSource({
        workspaceId,
        connectorId: connector.id,
        selector: { schema, table: selectedTable },
      }),
  })

  const importMutation = useMutation({
    mutationFn: () =>
      importConnectorSource({
        workspaceId,
        connectorId: connector.id,
        source: { schema, table: selectedTable },
        target: buildTarget(target, fields, null),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['connectors', connector.id, 'runs'],
      })
      void queryClient.invalidateQueries({ queryKey: ['datasets'] })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Source — external database (read-only)</CardTitle>
        <CardDescription>
          Discover schemas, tables and views, preview a bounded selection and
          import it. This connector is strictly read-only: no arbitrary SQL,
          writes or DDL. Imports go through canonical Dataset validation.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <TestConnectionButton
          workspaceId={workspaceId}
          connectorId={connector.id}
        />

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={discoverMutation.isPending}
            onClick={() => discoverMutation.mutate('')}
          >
            List schemas
          </Button>
          {discoverMutation.error instanceof Error && (
            <span role="alert" className="text-destructive text-xs">
              {discoverMutation.error.message}
            </span>
          )}
        </div>

        {discovery && (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Schema</Label>
              <Select
                value={schema}
                onChange={(event) => {
                  setSchema(event.target.value)
                  setSelectedTable('')
                  discoverMutation.mutate(event.target.value)
                }}
              >
                <option value="">Select a schema…</option>
                {discovery.schemas.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
            {schema && (
              <div className="grid gap-2">
                <Label>Table / view</Label>
                <Select
                  value={selectedTable}
                  onChange={(event) => setSelectedTable(event.target.value)}
                >
                  <option value="">Select a table…</option>
                  {discovery.tables.map((table) => (
                    <option key={table.name} value={table.name}>
                      {table.name} ({table.kind})
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        )}

        {selectedTableDescriptor && (
          <div className="grid gap-3">
            <p className="text-muted-foreground text-xs">
              Columns:{' '}
              <span className="font-mono">
                {selectedTableDescriptor.columns
                  .map((column) => column.name)
                  .join(', ')}
              </span>
            </p>
            <Button
              size="sm"
              variant="ghost"
              disabled={previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              Preview (bounded)
            </Button>
            {previewMutation.data && (
              <div className="grid gap-2">
                <MappingSummary
                  headers={previewMutation.data.columns}
                  fields={fields}
                />
                <PreviewTable preview={previewMutation.data} />
                {previewMutation.data.truncated && (
                  <p className="text-muted-foreground text-xs">
                    Preview truncated at the connector's preview row cap.
                  </p>
                )}
              </div>
            )}
            <TargetControls state={target} onChange={setTarget} />
            <ImportButton
              disabled={
                !targetReady(target) ||
                fields.length === 0 ||
                importMutation.isPending
              }
              pending={importMutation.isPending}
              onClick={() => importMutation.mutate()}
            />
          </div>
        )}
        <ImportFeedback
          error={importMutation.error}
          receipt={importMutation.data}
        />
      </CardContent>
    </Card>
  )
}
