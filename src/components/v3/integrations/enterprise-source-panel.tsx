/**
 * INT-03 — enterprise connector source panel (S3 / PostgreSQL).
 * UI port: app-3's v3 kit.
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

import { Button } from '#/components/v3/ui/button'
import { LoadMore } from '#/components/v3/ui/load-more'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Select } from '#/components/v3/ui/select'
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
    <div className="flex flex-col gap-3">
      <Field label="Target Schema Version">
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
      </Field>
      {state.schemaVersionId && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Existing Dataset">
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
          </Field>
          {!state.datasetId && (
            <Field label="New Dataset name">
              <Input
                value={state.newDatasetName}
                onChange={(event) =>
                  onChange({ ...state, newDatasetName: event.target.value })
                }
                placeholder="Import — source data"
              />
            </Field>
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
    <ul className="m-0 list-none space-y-0.5 p-0 text-label text-fg-muted">
      {mappings.map((mapping) => (
        <li key={mapping.source} className="mono">
          {mapping.source} →{' '}
          {mapping.kind === 'field' ? mapping.field.label : 'ignored'}
        </li>
      ))}
      {mapped.length === 0 && (
        <li className="text-danger-text">No columns map to Schema fields.</li>
      )}
    </ul>
  )
}

function PreviewTable({ preview }: { preview: PreviewResult }) {
  if (preview.columns.length === 0) return null
  return (
    <Table aria-label="Source preview">
      <TableHeader>
        <TableRow>
          {preview.columns.map((column) => (
            <TableHead key={column} className="mono text-label">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {preview.rows.map((row, index) => (
          <TableRow key={index}>
            {preview.columns.map((column) => (
              <TableCell key={column} className="mono text-label">
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
      <Button
        size="sm"
        variant="primary"
        icon="download"
        disabled={disabled}
        onClick={onClick}
      >
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
        <Notice tone="bad" title="Import failed — recorded as a failed run">
          {error.message}
        </Notice>
      )}
      {receipt && (
        <Notice tone="info">
          <span className="font-semibold">
            Run {receipt.alreadyCompleted ? 'already completed' : 'succeeded'} (
            attempt #{receipt.attempt})
          </span>
          <p className="m-0">
            {receipt.rowCount} rows landed in Dataset{' '}
            <span className="mono">{receipt.datasetId}</span>, run{' '}
            <span className="mono">{receipt.runId}</span>. Provenance is
            attached to the run below.
          </p>
        </Notice>
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
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Testing…' : 'Test connection'}
      </Button>
      {mutation.data && <Status tone="ok">ok</Status>}
      {mutation.error instanceof Error && (
        <span role="alert" className="text-label text-danger-text">
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
    <Section title="Source — object storage">
      <p className="m-0 max-w-3xl text-body text-fg-muted">
        Discover objects under the configured bucket/prefix, preview one and
        import it. The raw object is retained in the file platform before the
        run; imports go through canonical Dataset validation.
      </p>

      <div className="flex max-w-3xl flex-col gap-4">
        <TestConnectionButton
          workspaceId={workspaceId}
          connectorId={connector.id}
        />

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={discoverMutation.isPending}
            onClick={() => {
              discoverMutation.mutate(null)
            }}
          >
            List objects
          </Button>
          <LoadMore
            label="Object storage objects"
            hasMore={Boolean(continuationToken)}
            loading={discoverMutation.isPending}
            error={
              discoverMutation.error instanceof Error
                ? discoverMutation.error.message
                : undefined
            }
            onLoadMore={() => discoverMutation.mutate(continuationToken)}
          />
        </div>

        {objects.length > 0 && (
          <Table aria-label="Object storage">
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Modified</TableHead>
                <TableHead aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {objects.map((object) => (
                <TableRow key={object.key}>
                  <TableCell className="mono text-label">
                    {object.key}
                  </TableCell>
                  <TableCell className="text-label">
                    {object.byteSize}
                  </TableCell>
                  <TableCell className="text-label">
                    {object.lastModified
                      ? new Date(object.lastModified).toLocaleString()
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={selectedKey === object.key ? 'primary' : 'quiet'}
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
          <div className="flex flex-col gap-3">
            <p className="m-0 text-label text-fg-muted">
              Selected <span className="mono">{selectedKey}</span>
            </p>
            {previewMutation.data && (
              <div className="flex flex-col gap-2">
                <MappingSummary
                  headers={previewMutation.data.columns}
                  fields={fields}
                />
                <PreviewTable preview={previewMutation.data} />
              </div>
            )}
            <Field label="Retain raw object in project">
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
            </Field>
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
      </div>
    </Section>
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
    <Section title="Source — external database (read-only)">
      <p className="m-0 max-w-3xl text-body text-fg-muted">
        Discover schemas, tables and views, preview a bounded selection and
        import it. This connector is strictly read-only: no arbitrary SQL,
        writes or DDL. Imports go through canonical Dataset validation.
      </p>

      <div className="flex max-w-3xl flex-col gap-4">
        <TestConnectionButton
          workspaceId={workspaceId}
          connectorId={connector.id}
        />

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={discoverMutation.isPending}
            onClick={() => discoverMutation.mutate('')}
          >
            List schemas
          </Button>
          {discoverMutation.error instanceof Error && (
            <span role="alert" className="text-label text-danger-text">
              {discoverMutation.error.message}
            </span>
          )}
        </div>

        {discovery && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Schema">
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
            </Field>
            {schema && (
              <Field label="Table / view">
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
              </Field>
            )}
          </div>
        )}

        {selectedTableDescriptor && (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-label text-fg-muted">
              Columns:{' '}
              <span className="mono">
                {selectedTableDescriptor.columns
                  .map((column) => column.name)
                  .join(', ')}
              </span>
            </p>
            <div>
              <Button
                size="sm"
                variant="quiet"
                disabled={previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
              >
                Preview (bounded)
              </Button>
            </div>
            {previewMutation.data && (
              <div className="flex flex-col gap-2">
                <MappingSummary
                  headers={previewMutation.data.columns}
                  fields={fields}
                />
                <PreviewTable preview={previewMutation.data} />
                {previewMutation.data.truncated && (
                  <p className="m-0 text-label text-fg-muted">
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
      </div>
    </Section>
  )
}
