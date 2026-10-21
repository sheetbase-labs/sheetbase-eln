import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import {
  listCanonicalDatasetSchemaDefinitions,
  listCanonicalDatasetSchemaVersions,
  listCanonicalDatasetSchemaVersionFields,
} from '#/lib/dataset-schema-definition-rpc'
import type {
  CanonicalDatasetSchemaDefinition,
  CanonicalDatasetSchemaField,
  CanonicalDatasetSchemaVersion,
} from '#/lib/dataset-schema-definition-rpc'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  displayModelFieldValue,
  fetchModelFields,
  modelFieldValuesFromInput,
  parseModelFieldInput,
  validateModelFieldValue,
} from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import { fetchModelRules } from '#/lib/model-rules'
import type { ModelRule } from '#/lib/model-rules'
import { fetchRecordTimeline } from '#/lib/sign-002'
import type { TimelineEventWire } from '#/lib/sign-002'
import { delimitedHeaderLine, delimitedRowLine } from '#/lib/export/delimited'
import type { ExportField, ExportRow } from '#/lib/export/delimited'
import { listByIds } from '#/lib/chunk-ids'

/**
 * UI port (roadmap-4/ui-app3): the Models board reads the canonical dataset
 * schema registry, not a fixture. A model is a `dataset_schema_definition`; its
 * versions are `dataset_schema_versions` and its fields live on the selected
 * version. The app-3 Record/Measurement split and owner/display id are not in
 * this model and render as gaps.
 */
export interface ModelRow extends CanonicalDatasetSchemaDefinition {
  versions: CanonicalDatasetSchemaVersion[]
  latestVersion: CanonicalDatasetSchemaVersion | null
  /** The in-service version: the highest published version, else the newest. */
  publishedVersion: CanonicalDatasetSchemaVersion | null
  fieldCount: number
  datasetCount: number
}

export function modelStatus(lifecycle: string): { tone: Tone; label: string } {
  switch (lifecycle) {
    case 'active':
      return { tone: 'ok', label: 'Active' }
    case 'published':
      return { tone: 'ok', label: 'Published' }
    case 'draft':
      return { tone: 'draft', label: 'Draft' }
    case 'retired':
      return { tone: 'stored', label: 'Retired' }
    default:
      return {
        tone: 'none',
        label:
          lifecycle.charAt(0).toUpperCase() +
          lifecycle.slice(1).replace(/_/g, ' '),
      }
  }
}

export const modelsQueryKeys = {
  list: ['ui-port', 'models', 'list'] as const,
  versions: (modelId: string) =>
    ['ui-port', 'models', 'versions', modelId] as const,
  fields: (versionId: string) =>
    ['ui-port', 'models', 'fields', versionId] as const,
  versionFields: (versionIds: string[]) =>
    ['ui-port', 'models', 'version-fields', versionIds.join(',')] as const,
  datasets: (modelId: string) =>
    ['ui-port', 'models', 'datasets', modelId] as const,
}

/** Pure aggregation so the list mapping can be tested without a client. */
export function buildModelRows(
  definitions: CanonicalDatasetSchemaDefinition[],
  versions: CanonicalDatasetSchemaVersion[],
  fields: { schema_version_id: string }[],
  datasets: { schema_version_id: string }[],
): ModelRow[] {
  const bySchema = new Map<string, CanonicalDatasetSchemaVersion[]>()
  for (const v of versions) {
    const list = bySchema.get(v.schema_id) ?? []
    list.push(v)
    bySchema.set(v.schema_id, list)
  }
  for (const list of bySchema.values())
    list.sort((a, b) => b.version - a.version)
  const fieldCounts = new Map<string, number>()
  for (const f of fields)
    fieldCounts.set(
      f.schema_version_id,
      (fieldCounts.get(f.schema_version_id) ?? 0) + 1,
    )
  const datasetCounts = new Map<string, number>()
  for (const d of datasets)
    datasetCounts.set(
      d.schema_version_id,
      (datasetCounts.get(d.schema_version_id) ?? 0) + 1,
    )
  return definitions.map((d) => {
    const list = bySchema.get(d.id) ?? []
    // The board describes the in-service version: the highest published
    // version, or the newest when nothing is published yet. Counting the
    // newest unconditionally would describe an unpublished draft's fields for
    // a model whose datasets are pinned to a published version.
    const published = list.find((v) => v.lifecycle === 'published') ?? null
    const reported = published ?? list.at(0) ?? null
    return {
      ...d,
      versions: list,
      latestVersion: list.at(0) ?? null,
      publishedVersion: published,
      fieldCount: reported ? (fieldCounts.get(reported.id) ?? 0) : 0,
      datasetCount: reported ? (datasetCounts.get(reported.id) ?? 0) : 0,
    }
  })
}

export function useModels(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: modelsQueryKeys.list,
    queryFn: async (): Promise<ModelRow[]> => {
      const definitions = await listCanonicalDatasetSchemaDefinitions(client)
      if (definitions.length === 0) return []
      const versions = await client.list<CanonicalDatasetSchemaVersion>(
        'dataset_schema_versions',
        '?select=id,schema_id,version,revision,lifecycle,published_at&order=version.desc',
      )
      // Fetch fields and datasets for the version the board reports on — the
      // highest published version, else the newest — matching buildModelRows.
      const reportedVersionIds = definitions
        .map((d) => {
          const own = versions.filter((v) => v.schema_id === d.id)
          const reported =
            own.find((v) => v.lifecycle === 'published') ?? own.at(0)
          return reported?.id
        })
        .filter((id): id is string => Boolean(id))
      // The proxy refuses a query value over 500 characters, so a long id list
      // is read in groups instead of one `in.(…)`.
      const groups: string[][] = []
      for (let i = 0; i < reportedVersionIds.length; i += 12)
        groups.push(reportedVersionIds.slice(i, i + 12))
      const [fieldGroups, datasetGroups] = await Promise.all([
        Promise.all(
          groups.map((ids) =>
            client.list<{ field_id: string; schema_version_id: string }>(
              'dataset_schema_version_fields',
              `?schema_version_id=in.(${ids.join(',')})&select=field_id,schema_version_id`,
            ),
          ),
        ),
        Promise.all(
          groups.map((ids) =>
            client.list<{ id: string; schema_version_id: string }>(
              'datasets',
              `?schema_version_id=in.(${ids.join(',')})&select=id,schema_version_id`,
            ),
          ),
        ),
      ])
      const fields = fieldGroups.flat()
      const datasets = datasetGroups.flat()
      return buildModelRows(definitions, versions, fields, datasets)
    },
    staleTime: 15_000,
  })
}

export function useModelDefinition(
  modelId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: ['ui-port', 'models', 'definition', modelId],
    queryFn: () =>
      client
        .list<CanonicalDatasetSchemaDefinition>(
          'dataset_schema_definitions',
          `?id=eq.${modelId}&select=id,key,name,description,lifecycle,created_at,updated_at`,
        )
        .then((rows) => rows[0] ?? null),
    staleTime: 15_000,
  })
}

export function useModelVersions(
  modelId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: modelsQueryKeys.versions(modelId),
    queryFn: () => listCanonicalDatasetSchemaVersions(client, modelId),
    staleTime: 15_000,
  })
}

export function useModelFields(
  versionId: string | undefined,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: modelsQueryKeys.fields(versionId ?? ''),
    queryFn: () =>
      listCanonicalDatasetSchemaVersionFields(client, versionId as string),
    enabled: Boolean(versionId),
    staleTime: 15_000,
  })
}

export interface ModelVersionField extends CanonicalDatasetSchemaField {
  schema_version_id: string
}

/** Fields for every version of one model in a single read, so the Versions tab
 * can diff each version against its predecessor without a query per version. */
export function useModelVersionFields(
  versionIds: string[],
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: modelsQueryKeys.versionFields(versionIds),
    queryFn: () =>
      versionIds.length
        ? listByIds(versionIds, (inList) =>
            client.list<ModelVersionField>(
              'dataset_schema_version_fields',
              `?schema_version_id=in.(${inList})&select=field_id,schema_version_id,key,label,description,logical_type,nullable,default_value,quantity,validation,category,relationship,cardinality,lifecycle,display_order&order=display_order.asc`,
            ),
          ).then((fields) =>
            fields.sort((a, b) => a.display_order - b.display_order),
          )
        : Promise.resolve([]),
    enabled: versionIds.length > 0,
    staleTime: 15_000,
  })
}

export interface ModelDatasetUse {
  id: string
  schema_version_id: string
  name: string | null
  display_id: string | null
  archived_at: string | null
  updated_at: string
}

export function useModelDatasets(
  versionIds: string[],
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: [...modelsQueryKeys.datasets(versionIds.join(',')), versionIds],
    queryFn: async () =>
      (
        await listByIds(versionIds, (inList) =>
          client.list<ModelDatasetUse>(
            'datasets',
            `?schema_version_id=in.(${inList})&select=id,schema_version_id,name,display_id,archived_at,updated_at&order=updated_at.desc`,
          ),
        )
      ).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    enabled: versionIds.length > 0,
    staleTime: 15_000,
  })
}

export type { CanonicalDatasetSchemaField, CanonicalDatasetSchemaVersion }

// ---------------------------------------------------------------------------
// MDL-04.1 — records of a workspace-defined record model (ADR-0051).
//
// A workspace model is a `record_models` row keyed by its stable `key`. Its
// active `record_field_definitions` (kind = key) are the list columns; its
// records are `api.records` rows with `kind = key`, scoped by workspace RLS.
// The helpers here are pure so the list/CSV behaviour is unit-testable without
// a live client.
// ---------------------------------------------------------------------------

export interface WorkspaceRecordModel {
  id: string
  workspace_id: string
  key: string
  name: string
  description: string | null
  identifier_prefix: string
  lifecycle: string
  current_version: number
  created_at: string
  updated_at: string
}

export interface ModelKindRef {
  key: string
  label: string
  identity_table: string
  record_kind: string | null
}

export interface RecordModelRecord {
  id: string
  identifier: string
  title: string
  kind: string
  status: string
  custom_fields: Record<string, unknown> | null
  properties: Record<string, unknown> | null
  tags: string[]
  created_at: string
  updated_at: string
  archived_at: string | null
}

export const recordModelQueryKeys = {
  model: (key: string) => ['ui-port', 'record-models', 'model', key] as const,
  kind: (key: string) => ['ui-port', 'record-models', 'kind', key] as const,
  fields: (key: string) => ['ui-port', 'record-models', 'fields', key] as const,
  records: (key: string) =>
    ['ui-port', 'record-models', 'records', key] as const,
}

const WORKSPACE_MODEL_COLUMNS =
  'id,workspace_id,key,name,description,identifier_prefix,lifecycle,current_version,created_at,updated_at'

const RECORD_MODEL_RECORD_COLUMNS =
  'id,identifier,title,kind,status,custom_fields,properties,tags,created_at,updated_at,archived_at'

/** Resolve a workspace-defined record model by its stable key. RLS keeps this
 * workspace-scoped; another workspace's model reads as not found. */
export function useWorkspaceRecordModel(
  key: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: recordModelQueryKeys.model(key),
    queryFn: () =>
      client
        .list<WorkspaceRecordModel>(
          'record_models',
          `?key=eq.${encodeURIComponent(key)}&select=${WORKSPACE_MODEL_COLUMNS}`,
        )
        .then((rows) => rows[0] ?? null),
    enabled: Boolean(key),
    staleTime: 15_000,
  })
}

/** Resolve a built-in `model_kinds` row, so a built-in key can be told apart
 * from a workspace model and linked to its existing surface. */
export function useBuiltInModelKind(
  key: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: recordModelQueryKeys.kind(key),
    queryFn: () =>
      client
        .list<ModelKindRef>(
          'model_kinds',
          `?key=eq.${encodeURIComponent(key)}&select=key,label,identity_table,record_kind`,
        )
        .then((rows) => rows[0] ?? null),
    enabled: Boolean(key),
    staleTime: 60_000,
  })
}

/** The model's active field definitions in display order — the list columns. */
export function useRecordModelFields(
  key: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: recordModelQueryKeys.fields(key),
    queryFn: () => fetchModelFields(client, key),
    enabled: Boolean(key),
    staleTime: 15_000,
  })
}

/** Records of the model. `kind` is the model key; RLS scopes the workspace. */
export function useRecordModelRecords(
  key: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: recordModelQueryKeys.records(key),
    queryFn: () =>
      client.list<RecordModelRecord>(
        'records',
        `?kind=eq.${encodeURIComponent(key)}&deleted_at=is.null&order=updated_at.desc&select=${RECORD_MODEL_RECORD_COLUMNS}`,
      ),
    enabled: Boolean(key),
    staleTime: 15_000,
  })
}

/** Built-in kind surfaces. Built-ins keep their own list routes; a workspace
 * model key can never shadow one (create_workspace_model refuses it). */
type BuiltInKindSurface =
  | '/samples'
  | '/materials'
  | '/protocols'
  | '/experiments'
  | '/templates'
  | '/models'

export const BUILT_IN_KIND_SURFACES: Partial<
  Record<string, { to: BuiltInKindSurface; label: string }>
> = {
  sample: { to: '/samples', label: 'Samples' },
  material: { to: '/materials', label: 'Materials' },
  protocol_template: { to: '/protocols', label: 'Protocols' },
  experiment: { to: '/experiments', label: 'Experiments' },
  notebook_template: { to: '/templates', label: 'Templates' },
}

/**
 * Workspace models store field values in `custom_fields`; the legacy registry
 * `properties` object is an honest fallback so older records still render.
 */
export function recordFieldValue(
  record: Pick<RecordModelRecord, 'custom_fields' | 'properties'>,
  fieldName: string,
): unknown {
  const custom = record.custom_fields?.[fieldName]
  if (custom !== undefined) return custom
  return record.properties?.[fieldName]
}

/** Free text a row matches on: identifier, title, status and shown field values. */
export function buildRecordSearchText(
  record: RecordModelRecord,
  fields: ModelFieldDefinition[],
): string {
  return [
    record.identifier,
    record.title,
    record.status,
    ...fields.map((field) =>
      displayModelFieldValue(field, recordFieldValue(record, field.fieldName)),
    ),
  ]
    .join(' ')
    .toLowerCase()
}

export interface RecordModelFilters {
  q?: string
  status?: string
  fieldName?: string
  fieldValue?: string
}

export function filterRecordModelRecords(
  records: RecordModelRecord[],
  fields: ModelFieldDefinition[],
  filters: RecordModelFilters,
): RecordModelRecord[] {
  const q = (filters.q ?? '').trim().toLowerCase()
  const status = filters.status ?? ''
  const field = fields.find((f) => f.fieldName === filters.fieldName) ?? null
  const fieldValue = (filters.fieldValue ?? '').trim().toLowerCase()
  return records.filter((record) => {
    if (status && record.status !== status) return false
    if (field && fieldValue) {
      const shown = displayModelFieldValue(
        field,
        recordFieldValue(record, field.fieldName),
      ).toLowerCase()
      if (!shown.includes(fieldValue)) return false
    }
    if (q && !buildRecordSearchText(record, fields).includes(q)) return false
    return true
  })
}

/** Distinct statuses present in the data, for the status filter. */
export function recordStatusOptions(records: RecordModelRecord[]): string[] {
  return [...new Set(records.map((r) => r.status).filter(Boolean))].sort()
}

/** Export the visible rows as CSV via the canonical delimited serializers. */
export function recordModelCsv(
  records: RecordModelRecord[],
  fields: ModelFieldDefinition[],
): string {
  const exportFields: ExportField[] = [
    {
      id: '__identifier',
      key: 'identifier',
      label: 'ID',
      logicalType: 'text',
      nullable: false,
      unit: null,
    },
    {
      id: '__title',
      key: 'title',
      label: 'Name',
      logicalType: 'text',
      nullable: false,
      unit: null,
    },
    {
      id: '__status',
      key: 'status',
      label: 'Status',
      logicalType: 'text',
      nullable: false,
      unit: null,
    },
    ...fields.map((field) => ({
      id: `field:${field.fieldName}`,
      key: field.fieldName,
      label: field.label,
      logicalType: field.logicalType,
      nullable: field.nullable,
      unit: null,
    })),
  ]
  const rows: ExportRow[] = records.map((record) => ({
    rowId: record.id,
    revision: '',
    values: {
      __identifier: record.identifier,
      __title: record.title,
      __status: record.status,
      ...Object.fromEntries(
        fields.map((field) => {
          const shown = displayModelFieldValue(
            field,
            recordFieldValue(record, field.fieldName),
          )
          return [`field:${field.fieldName}`, shown === '—' ? '' : shown]
        }),
      ),
    },
  }))
  return [
    delimitedHeaderLine(exportFields, ','),
    ...rows.map((row) => delimitedRowLine(exportFields, row, ',')),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// MDL-04.2/.3 — generated form, record page and related reads.
// ---------------------------------------------------------------------------

export interface RecordModelProject {
  id: string
  key: string
  title: string
}

/** Incoming link (who uses this record), with the source record resolved. */
export interface RecordModelUsedBy {
  linkType: string
  createdAt: string
  source: {
    id: string
    identifier: string
    title: string
    kind: string
  } | null
}

export const recordModelDetailQueryKeys = {
  rules: (key: string) => ['ui-port', 'record-models', 'rules', key] as const,
  projects: ['ui-port', 'record-models', 'projects'] as const,
  record: (id: string) => ['ui-port', 'record-models', 'record', id] as const,
  usedBy: (id: string) => ['ui-port', 'record-models', 'used-by', id] as const,
  timeline: (id: string) =>
    ['ui-port', 'record-models', 'timeline', id] as const,
}

/** Rules for a workspace model, evaluated client-side for inline form hints. */
export function useModelRules(
  key: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: recordModelDetailQueryKeys.rules(key),
    queryFn: () => fetchModelRules(client, key),
    enabled: Boolean(key),
    staleTime: 30_000,
  })
}

/** Projects a new record can be filed under. */
export function useRecordModelProjects(
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: recordModelDetailQueryKeys.projects,
    queryFn: () =>
      client.list<RecordModelProject>(
        'projects',
        '?select=id,key,title&order=created_at.asc',
      ),
    staleTime: 60_000,
  })
}

export function useRecordModelRecord(
  recordId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: recordModelDetailQueryKeys.record(recordId),
    queryFn: () =>
      client
        .list<RecordModelRecord>(
          'records',
          `?id=eq.${encodeURIComponent(recordId)}&select=${RECORD_MODEL_RECORD_COLUMNS}`,
        )
        .then((rows) => rows[0] ?? null),
    enabled: Boolean(recordId),
    staleTime: 15_000,
  })
}

/** Records that link to this one, with the source record resolved. */
export function useRecordModelUsedBy(
  recordId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: recordModelDetailQueryKeys.usedBy(recordId),
    queryFn: () =>
      client.list<RecordModelUsedBy>(
        'record_links',
        `?target_record_id=eq.${encodeURIComponent(recordId)}&select=link_type,created_at,source:source_record_id(id,identifier,title,kind)&order=created_at.desc`,
      ),
    enabled: Boolean(recordId),
    staleTime: 15_000,
  })
}

/** The canonical record timeline (change events, revisions, reviews…). */
export function useRecordModelTimeline(
  recordId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: recordModelDetailQueryKeys.timeline(recordId),
    queryFn: () => fetchRecordTimeline(client, recordId),
    enabled: Boolean(recordId),
    staleTime: 15_000,
  })
}

/**
 * The identifier the next record will get, e.g. `CB-0013`. The durable counter
 * lives server-side in `internal.id_sequences`, which is not exposed; this is
 * an estimate from the highest identifier already visible, and the server
 * assigns the real value on save.
 */
export function recordModelNextIdentifier(
  prefix: string,
  records: Pick<RecordModelRecord, 'identifier'>[],
): string {
  const highest = records.reduce((max, record) => {
    const match = /-(\d+)$/.exec(record.identifier)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `${prefix}-${String(highest + 1).padStart(4, '0')}`
}

/** Client-side errors for a generated form, keyed by field name. */
export function modelFieldInputErrors(
  fields: ModelFieldDefinition[],
  values: Record<string, string | boolean>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const fallback = field.logicalType === 'boolean' ? false : ''
    const raw = values[field.fieldName] ?? fallback
    // A blank value with a server default is valid: the RPC fills it in.
    if (
      raw === '' &&
      field.defaultValue !== null &&
      field.defaultValue !== undefined
    )
      continue
    const parsed = parseModelFieldInput(field, raw)
    const error = validateModelFieldValue(field, parsed)
    if (error) errors[field.fieldName] = error
  }
  return errors
}

const MODEL_FIELD_ERROR_MESSAGES: Record<string, string> = {
  required_value: 'A required value is missing.',
  numeric_validation: 'The value is outside the allowed range.',
  text_validation: 'The text does not match the field’s rules.',
  invalid_value_type: 'The value type does not match the field.',
  invalid_value: 'That value is not allowed.',
  invalid_reference: 'The linked record was not found in this workspace.',
  invalid_category_option: 'That category option is not available.',
  invalid_cardinality: 'The number of values is wrong for this field.',
}

/** Human message for a kernel validation code; unknown codes stay visible. */
export function modelFieldErrorMessage(code: string): string {
  return MODEL_FIELD_ERROR_MESSAGES[code] ?? `Couldn’t save (${code}).`
}

/** Build the `custom_fields` object the RPC receives, omitting blank values. */
export function buildRecordModelCustomFields(
  fields: ModelFieldDefinition[],
  values: Record<string, string | boolean>,
): Record<string, unknown> {
  return modelFieldValuesFromInput(fields, values, true)
}

/**
 * Active fields the model gained after this record was created and that the
 * record does not yet carry — the "added in a later version" banner.
 */
export function laterAddedModelFields(
  fields: ModelFieldDefinition[],
  record: Pick<
    RecordModelRecord,
    'created_at' | 'custom_fields' | 'properties'
  >,
): ModelFieldDefinition[] {
  const created = Date.parse(record.created_at)
  if (!Number.isFinite(created)) return []
  return fields.filter((field) => {
    if (!field.createdAt) return false
    const fieldCreated = Date.parse(field.createdAt)
    if (!Number.isFinite(fieldCreated) || fieldCreated <= created) return false
    return recordFieldValue(record, field.fieldName) === undefined
  })
}

export type { TimelineEventWire, ModelRule }
