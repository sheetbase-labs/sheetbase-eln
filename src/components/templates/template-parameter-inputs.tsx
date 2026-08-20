import { useQuery } from '@tanstack/react-query'

import { Field, FieldLabel, Input, Select } from '#/components/ui'
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

function unavailableOption(value: string, exists: boolean) {
  return Boolean(value) && !exists
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
  const datasetNameById = new Map(
    (datasets.data ?? []).map((dataset) => [dataset.id, dataset.name]),
  )

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Template parameters
      </p>
      {parameters.map((parameter) => {
        const inputId = `template-parameter-${parameter.id}`
        const value = values[parameter.id] ?? ''
        if (parameter.type.kind === 'scalar') {
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
        if (parameter.type.kind === 'record') {
          const modelKey = parameter.type.modelKey
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
            </Field>
          )
        }
        if (parameter.type.kind === 'dataset') {
          const options = datasets.data ?? []
          return (
            <Field key={parameter.id}>
              <FieldLabel htmlFor={inputId}>{parameter.label}</FieldLabel>
              <Select
                id={inputId}
                value={value}
                disabled={datasets.isLoading}
                onChange={(event) => onChange(parameter.id, event.target.value)}
              >
                <option value="">
                  {datasets.isLoading
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
            </Field>
          )
        }
        const options = datasetVersions.data ?? []
        return (
          <Field key={parameter.id}>
            <FieldLabel htmlFor={inputId}>{parameter.label}</FieldLabel>
            <Select
              id={inputId}
              value={value}
              disabled={datasetVersions.isLoading}
              onChange={(event) => onChange(parameter.id, event.target.value)}
            >
              <option value="">
                {datasetVersions.isLoading
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
          </Field>
        )
      })}
    </div>
  )
}
