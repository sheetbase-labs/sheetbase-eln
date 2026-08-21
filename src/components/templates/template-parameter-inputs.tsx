import { useQuery } from '@tanstack/react-query'

import { Button, Field, FieldLabel, Input, Select } from '#/components/ui'
import type { DataClient } from '#/lib/data-client'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import type { DatasetVersionWire } from '#/lib/dataset-product'
import { toRecord } from '#/lib/notebook-data'
import type { RecordWire } from '#/lib/notebook-data'
import type { Parameter } from '#/lib/parameter'

const RECORD_SELECT =
  'id,workspace_id,project_id,folder_id,kind,identifier,title,status,tags,structure_version,metadata_version,created_at,updated_at,archived_at,deleted_at,created_by_user_id,updated_by_user_id,locked_at,locked_by_revision_id'
const DATASET_VERSION_SELECT =
  'id,dataset_id,workspace_id,schema_version_id,source_dataset_revision,label,created_at,created_by_user_id'
const SCHEMA_VERSION_SELECT = 'id,schema_id,version'
const SCHEMA_FIELD_SELECT =
  'schema_version_id,field_id,logical_type,quantity,category,relationship,cardinality,lifecycle'

type SchemaVersion = { id: string; schema_id: string; version: number }
type SchemaField = {
  schema_version_id: string
  field_id: string
  logical_type: string
  quantity: unknown
  category: unknown
  relationship: unknown
  cardinality: string
  lifecycle: string
}

function unavailableOption(value: string, exists: boolean) {
  return Boolean(value) && !exists
}

function sameFieldSemantics(left: SchemaField, right: SchemaField) {
  return (
    left.logical_type === right.logical_type &&
    left.cardinality === right.cardinality &&
    JSON.stringify(left.quantity) === JSON.stringify(right.quantity) &&
    JSON.stringify(left.category) === JSON.stringify(right.category) &&
    JSON.stringify(left.relationship) === JSON.stringify(right.relationship)
  )
}

function datasetSatisfiesContract({
  candidateSchemaVersionId,
  contract,
  schemaVersions,
  fieldsBySchemaVersion,
}: {
  candidateSchemaVersionId: string
  contract: Extract<
    Parameter['type'],
    { kind: 'dataset' | 'dataset-version' }
  >['contract']
  schemaVersions: Map<string, SchemaVersion>
  fieldsBySchemaVersion: Map<string, SchemaField[]>
}) {
  if (contract.mode === 'exact')
    return candidateSchemaVersionId === contract.schemaVersionId
  const candidate = schemaVersions.get(candidateSchemaVersionId)
  const baseline = schemaVersions.get(contract.baselineSchemaVersionId ?? '')
  if (contract.mode === 'lineage') {
    if (
      !candidate ||
      !baseline ||
      candidate.schema_id !== baseline.schema_id ||
      candidate.version < baseline.version
    )
      return false
    const candidateFields = fieldsBySchemaVersion.get(candidate.id) ?? []
    return (fieldsBySchemaVersion.get(baseline.id) ?? [])
      .filter((field) => field.lifecycle === 'active')
      .every((baselineField) =>
        candidateFields.some(
          (candidateField) =>
            candidateField.lifecycle === 'active' &&
            candidateField.field_id === baselineField.field_id &&
            sameFieldSemantics(candidateField, baselineField),
        ),
      )
  }
  const candidateFields =
    fieldsBySchemaVersion.get(candidateSchemaVersionId) ?? []
  if (!candidate) return false
  if (baseline && candidate.schema_id !== baseline.schema_id) return false
  return contract.requiredFieldIds.every((fieldId) => {
    const candidateField = candidateFields.find(
      (field) => field.lifecycle === 'active' && field.field_id === fieldId,
    )
    if (!candidateField) return false
    const baselineField = (
      fieldsBySchemaVersion.get(baseline?.id ?? '') ?? []
    ).find(
      (field) => field.lifecycle === 'active' && field.field_id === fieldId,
    )
    return !baselineField || sameFieldSemantics(candidateField, baselineField)
  })
}

function SelectorFeedback({
  label,
  isLoading,
  isError,
  isEmpty,
  onRetry,
}: {
  label: string
  isLoading: boolean
  isError: boolean
  isEmpty: boolean
  onRetry: () => void
}) {
  if (isError) {
    return (
      <div className="flex items-center gap-2" role="alert">
        <p className="text-xs text-destructive">Could not load {label}.</p>
        <Button size="sm" type="button" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  }
  if (!isLoading && isEmpty)
    return (
      <p className="text-xs text-muted-foreground">No {label} available.</p>
    )
  return null
}

export function TemplateParameterInputs({
  client,
  workspaceId,
  parameters,
  values,
  onChange,
}: {
  client: DataClient
  workspaceId: string
  parameters: Parameter[]
  values: Record<string, string>
  onChange: (parameterId: string, value: string) => void
}) {
  const recordKinds = [
    ...new Set(
      parameters.flatMap((parameter) =>
        parameter.type.kind === 'record' ? [parameter.type.modelKey] : [],
      ),
    ),
  ]
  const needsDatasets = parameters.some(
    (parameter) =>
      parameter.type.kind === 'dataset' ||
      parameter.type.kind === 'dataset-version',
  )
  const needsDatasetVersions = parameters.some(
    (parameter) => parameter.type.kind === 'dataset-version',
  )
  const nonExactContracts = parameters.flatMap((parameter) =>
    parameter.type.kind === 'dataset' ||
    parameter.type.kind === 'dataset-version'
      ? parameter.type.contract.mode === 'exact'
        ? []
        : [parameter.type.contract]
      : [],
  )
  const records = useQuery({
    queryKey: ['template-parameter-records', workspaceId, recordKinds],
    queryFn: () =>
      client
        .list<RecordWire>(
          'records',
          `?kind=in.(${recordKinds.map(encodeURIComponent).join(',')})&archived_at=is.null&order=title.asc&limit=200&select=${RECORD_SELECT}`,
        )
        .then((rows) => rows.map(toRecord)),
    enabled: recordKinds.length > 0,
  })
  const datasets = useQuery({
    queryKey: ['template-parameter-datasets', workspaceId],
    queryFn: () => fetchDatasetSummaries(client),
    enabled: needsDatasets,
  })
  const datasetVersions = useQuery({
    queryKey: ['template-parameter-dataset-versions', workspaceId],
    queryFn: () =>
      client.list<DatasetVersionWire>(
        'dataset_versions',
        `?order=created_at.desc&limit=200&select=${DATASET_VERSION_SELECT}`,
      ),
    enabled: needsDatasetVersions,
  })
  const candidateSchemaVersionIds = [
    ...new Set([
      ...(datasets.data ?? []).map(
        (dataset) => dataset.schema_version_id ?? '',
      ),
      ...(datasetVersions.data ?? []).map(
        (version) => version.schema_version_id,
      ),
    ]),
  ].filter(Boolean)
  const compatibilitySchemaVersionIds = [
    ...new Set([
      ...candidateSchemaVersionIds,
      ...nonExactContracts.flatMap((contract) =>
        contract.mode === 'lineage'
          ? [contract.baselineSchemaVersionId]
          : contract.baselineSchemaVersionId
            ? [contract.baselineSchemaVersionId]
            : [],
      ),
    ]),
  ]
  const schemaVersions = useQuery({
    queryKey: [
      'template-parameter-schema-versions',
      workspaceId,
      compatibilitySchemaVersionIds,
    ],
    queryFn: () =>
      client.list<SchemaVersion>(
        'dataset_schema_versions',
        `?id=in.(${compatibilitySchemaVersionIds.map(encodeURIComponent).join(',')})&select=${SCHEMA_VERSION_SELECT}`,
      ),
    enabled:
      nonExactContracts.length > 0 && compatibilitySchemaVersionIds.length > 0,
  })
  const schemaFields = useQuery({
    queryKey: [
      'template-parameter-schema-fields',
      workspaceId,
      compatibilitySchemaVersionIds,
    ],
    queryFn: () =>
      client.list<SchemaField>(
        'dataset_schema_version_fields',
        `?schema_version_id=in.(${compatibilitySchemaVersionIds.map(encodeURIComponent).join(',')})&select=${SCHEMA_FIELD_SELECT}`,
      ),
    enabled:
      nonExactContracts.length > 0 && compatibilitySchemaVersionIds.length > 0,
  })
  const datasetNameById = new Map(
    (datasets.data ?? []).map((dataset) => [dataset.id, dataset.name]),
  )
  const schemaVersionById = new Map(
    (schemaVersions.data ?? []).map((version) => [version.id, version]),
  )
  const fieldsBySchemaVersion = new Map<string, SchemaField[]>()
  for (const field of schemaFields.data ?? []) {
    const fields = fieldsBySchemaVersion.get(field.schema_version_id) ?? []
    fields.push(field)
    fieldsBySchemaVersion.set(field.schema_version_id, fields)
  }
  const compatibilityLoading =
    nonExactContracts.length > 0 &&
    (schemaVersions.isLoading || schemaFields.isLoading)
  const compatibilityError = schemaVersions.isError || schemaFields.isError
  const isCompatible = (
    schemaVersionId: string,
    contract: Extract<
      Parameter['type'],
      { kind: 'dataset' | 'dataset-version' }
    >['contract'],
  ) =>
    datasetSatisfiesContract({
      candidateSchemaVersionId: schemaVersionId,
      contract,
      schemaVersions: schemaVersionById,
      fieldsBySchemaVersion,
    })

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Template parameters
      </p>
      {parameters.map((parameter) => {
        const inputId = `template-parameter-${parameter.id}`
        const value = values[parameter.id] ?? ''
        const type = parameter.type
        if (type.kind === 'scalar') {
          return (
            <Field key={parameter.id}>
              <FieldLabel htmlFor={inputId}>{parameter.label}</FieldLabel>
              <Input
                id={inputId}
                value={value}
                onChange={(event) => onChange(parameter.id, event.target.value)}
                placeholder="Enter a value"
              />
            </Field>
          )
        }
        if (type.kind === 'record') {
          const modelKey = type.modelKey
          const options = (records.data ?? []).filter(
            (record) => record.kind === modelKey,
          )
          return (
            <Field key={parameter.id}>
              <FieldLabel htmlFor={inputId}>{parameter.label}</FieldLabel>
              <Select
                id={inputId}
                value={value}
                disabled={records.isLoading}
                onChange={(event) => onChange(parameter.id, event.target.value)}
              >
                <option value="">
                  {records.isLoading ? 'Loading records…' : 'Select a record'}
                </option>
                {unavailableOption(
                  value,
                  options.some((record) => record.id === value),
                ) ? (
                  <option value={value}>{value} (no longer available)</option>
                ) : null}
                {options.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.identifier} · {record.title}
                  </option>
                ))}
              </Select>
              <SelectorFeedback
                label="records"
                isLoading={records.isLoading}
                isError={records.isError}
                isEmpty={options.length === 0}
                onRetry={() => void records.refetch()}
              />
            </Field>
          )
        }
        if (type.kind === 'dataset') {
          const options = (datasets.data ?? []).filter((dataset) =>
            isCompatible(dataset.schema_version_id ?? '', type.contract),
          )
          return (
            <Field key={parameter.id}>
              <FieldLabel htmlFor={inputId}>{parameter.label}</FieldLabel>
              <Select
                id={inputId}
                value={value}
                disabled={datasets.isLoading || compatibilityLoading}
                onChange={(event) => onChange(parameter.id, event.target.value)}
              >
                <option value="">
                  {datasets.isLoading || compatibilityLoading
                    ? 'Loading Datasets…'
                    : 'Select a Dataset'}
                </option>
                {unavailableOption(
                  value,
                  options.some((dataset) => dataset.id === value),
                ) ? (
                  <option value={value}>{value} (no longer available)</option>
                ) : null}
                {options.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))}
              </Select>
              <SelectorFeedback
                label="Datasets"
                isLoading={datasets.isLoading || compatibilityLoading}
                isError={datasets.isError || compatibilityError}
                isEmpty={options.length === 0}
                onRetry={() => {
                  void datasets.refetch()
                  void schemaVersions.refetch()
                  void schemaFields.refetch()
                }}
              />
            </Field>
          )
        }
        const options = (datasetVersions.data ?? []).filter((version) =>
          isCompatible(version.schema_version_id, type.contract),
        )
        return (
          <Field key={parameter.id}>
            <FieldLabel htmlFor={inputId}>{parameter.label}</FieldLabel>
            <Select
              id={inputId}
              value={value}
              disabled={datasetVersions.isLoading || compatibilityLoading}
              onChange={(event) => onChange(parameter.id, event.target.value)}
            >
              <option value="">
                {datasetVersions.isLoading || compatibilityLoading
                  ? 'Loading Dataset Versions…'
                  : 'Select a Dataset Version'}
              </option>
              {unavailableOption(
                value,
                options.some((version) => version.id === value),
              ) ? (
                <option value={value}>{value} (no longer available)</option>
              ) : null}
              {options.map((version) => (
                <option key={version.id} value={version.id}>
                  {datasetNameById.get(version.dataset_id) ?? 'Dataset'} ·{' '}
                  {version.label}
                </option>
              ))}
            </Select>
            <SelectorFeedback
              label="Dataset Versions"
              isLoading={datasetVersions.isLoading || compatibilityLoading}
              isError={datasetVersions.isError || compatibilityError}
              isEmpty={options.length === 0}
              onRetry={() => {
                void datasetVersions.refetch()
                void schemaVersions.refetch()
                void schemaFields.refetch()
              }}
            />
          </Field>
        )
      })}
    </div>
  )
}
