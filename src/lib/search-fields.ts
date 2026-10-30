import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import type { SearchResult, SearchResultGroup } from '#/lib/search'
import { searchResultGroup } from '#/lib/search'
import { t } from '#/copy'
import type { CopyKey } from '#/copy'

/**
 * The fields the "Add filter" builder offers. The names are the ones the
 * search service accepts in `p_filter`; per-type values the service returns on
 * a result (`fields`) are offered as `fields.<key>` once a single type is
 * chosen.
 */

export interface SearchOption {
  value: string
  label: string
}

/** What a person calls each thing the index holds, singular, for the Type picker. */
export const SEARCH_TYPE_OPTIONS: readonly SearchOption[] = [
  { value: 'experiment', label: t('projects.searchFilter.types.experiment') },
  { value: 'sample', label: t('projects.searchFilter.types.sample') },
  { value: 'material', label: t('projects.searchFilter.types.material') },
  {
    value: 'protocol_template',
    label: t('projects.searchFilter.types.protocol'),
  },
  { value: 'report', label: t('projects.searchFilter.types.report') },
  { value: 'study', label: t('projects.searchFilter.types.study') },
  { value: 'dataset', label: t('projects.searchFilter.types.dataset') },
  { value: 'sheet', label: t('projects.searchFilter.types.sheet') },
  { value: 'file', label: t('projects.searchFilter.types.file') },
  { value: 'template', label: t('projects.searchFilter.types.template') },
  { value: 'project', label: t('projects.searchFilter.types.project') },
  { value: 'pipeline', label: t('projects.searchFilter.types.pipeline') },
  { value: 'analysis', label: t('projects.searchFilter.types.analysis') },
  { value: 'comment', label: t('projects.searchFilter.types.comment') },
  { value: 'dataset_row', label: t('projects.searchFilter.types.datasetRow') },
  { value: 'sheet_row', label: t('projects.searchFilter.types.sheetRow') },
  { value: 'instrument', label: t('projects.searchFilter.types.instrument') },
  {
    value: 'instrument_run',
    label: t('projects.searchFilter.types.instrumentRun'),
  },
  { value: 'booking', label: t('projects.searchFilter.types.booking') },
  {
    value: 'storage_location',
    label: t('projects.searchFilter.types.storageLocation'),
  },
  { value: 'client', label: t('projects.searchFilter.types.client') },
  { value: 'deviation', label: t('projects.searchFilter.types.deviation') },
  {
    value: 'plate_design',
    label: t('projects.searchFilter.types.plateDesign'),
  },
  { value: 'parser', label: t('projects.searchFilter.types.parser') },
  { value: 'person', label: t('projects.searchFilter.types.person') },
]

const STATUS_VALUES = [
  'draft',
  'in_progress',
  'in_review',
  'approved',
  'archived',
  'available',
  'reserved',
  'consumed',
  'quarantined',
  'expired',
] as const

function humanise(value: string): string {
  const spaced = value.replace(/[_.]/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export const SEARCH_STATUS_OPTIONS: readonly SearchOption[] = STATUS_VALUES.map(
  (value) => ({ value, label: humanise(value) }),
)

/** Options whose label or value contains what was typed, best first. */
export function matchOptions(
  options: readonly SearchOption[],
  query: string,
  limit = 20,
): SearchOption[] {
  const needle = query.trim().toLowerCase()
  const hit = needle
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(needle) ||
          o.value.toLowerCase().includes(needle),
      )
    : [...options]
  return hit
    .sort((a, b) => {
      const aStart = a.label.toLowerCase().startsWith(needle) ? 0 : 1
      const bStart = b.label.toLowerCase().startsWith(needle) ? 0 : 1
      return aStart - bStart
    })
    .slice(0, limit)
}

export interface SearchFieldSources {
  /** Projects matching what was typed. */
  loadProjects: (query: string) => Promise<SearchOption[]>
  /** Workspace members matching what was typed. */
  loadOwners: (query: string) => Promise<SearchOption[]>
}

/** Fields every result has, whatever its type. */
export function commonSearchFields(
  sources: SearchFieldSources,
): SheetbaseField[] {
  return [
    {
      id: 'type',
      label: t('projects.searchFilter.fields.type'),
      dataType: 'text',
      loadOptions: async (query: string) =>
        matchOptions(SEARCH_TYPE_OPTIONS, query),
    },
    {
      id: 'status',
      label: t('projects.searchFilter.fields.status'),
      dataType: 'text',
      loadOptions: async (query: string) =>
        matchOptions(SEARCH_STATUS_OPTIONS, query),
    },
    {
      id: 'project',
      label: t('projects.searchFilter.fields.project'),
      dataType: 'text',
      loadOptions: sources.loadProjects,
    },
    {
      id: 'owner',
      label: t('projects.searchFilter.fields.owner'),
      dataType: 'text',
      loadOptions: sources.loadOwners,
    },
    {
      id: 'tags',
      label: t('projects.searchFilter.fields.tags'),
      dataType: 'text',
    },
    {
      id: 'created',
      label: t('projects.searchFilter.fields.created'),
      dataType: 'date',
    },
    {
      id: 'updated',
      label: t('projects.searchFilter.fields.updated'),
      dataType: 'date',
    },
    {
      id: 'archived',
      label: t('projects.searchFilter.fields.archived'),
      dataType: 'boolean',
    },
  ]
}

function dataTypeOf(value: unknown): SheetbaseField['dataType'] {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value))
    return 'date'
  return 'text'
}

const TYPE_FIELD_LABELS = {
  box: 'projects.searchFilter.typeFields.box',
  byte_size: 'projects.searchFilter.typeFields.byte_size',
  client: 'projects.searchFilter.typeFields.client',
  code: 'projects.searchFilter.typeFields.code',
  decision: 'projects.searchFilter.typeFields.decision',
  ends_at: 'projects.searchFilter.typeFields.ends_at',
  format: 'projects.searchFilter.typeFields.format',
  has_text: 'projects.searchFilter.typeFields.has_text',
  instrument: 'projects.searchFilter.typeFields.instrument',
  instrument_type: 'projects.searchFilter.typeFields.instrument_type',
  intended_use: 'projects.searchFilter.typeFields.intended_use',
  key: 'projects.searchFilter.typeFields.key',
  level: 'projects.searchFilter.typeFields.level',
  location: 'projects.searchFilter.typeFields.location',
  locked: 'projects.searchFilter.typeFields.locked',
  media_type: 'projects.searchFilter.typeFields.media_type',
  modality: 'projects.searchFilter.typeFields.modality',
  model: 'projects.searchFilter.typeFields.model',
  notebook: 'projects.searchFilter.typeFields.notebook',
  operator: 'projects.searchFilter.typeFields.operator',
  path: 'projects.searchFilter.typeFields.path',
  planned_end: 'projects.searchFilter.typeFields.planned_end',
  plate_format: 'projects.searchFilter.typeFields.plate_format',
  protocol: 'projects.searchFilter.typeFields.protocol',
  rack: 'projects.searchFilter.typeFields.rack',
  resolved: 'projects.searchFilter.typeFields.resolved',
  resource: 'projects.searchFilter.typeFields.resource',
  retired: 'projects.searchFilter.typeFields.retired',
  role: 'projects.searchFilter.typeFields.role',
  room: 'projects.searchFilter.typeFields.room',
  schema_key: 'projects.searchFilter.typeFields.schema_key',
  schema_name: 'projects.searchFilter.typeFields.schema_name',
  serial_number: 'projects.searchFilter.typeFields.serial_number',
  shelf: 'projects.searchFilter.typeFields.shelf',
  stage: 'projects.searchFilter.typeFields.stage',
  started_at: 'projects.searchFilter.typeFields.started_at',
  starts_at: 'projects.searchFilter.typeFields.starts_at',
  temperature_max_c: 'projects.searchFilter.typeFields.temperature_max_c',
  temperature_min_c: 'projects.searchFilter.typeFields.temperature_min_c',
  unit: 'projects.searchFilter.typeFields.unit',
  vendor: 'projects.searchFilter.typeFields.vendor',
  version: 'projects.searchFilter.typeFields.version',
} as const satisfies Record<string, CopyKey>

/** Keys that hold a person's id: Owner already filters by person. */
const HIDDEN_TYPE_FIELDS: ReadonlySet<string> = new Set(['reviewer', 'lead'])

/** What a scientist calls a per-type value; unknown keys fall back to the key. */
export function typeFieldLabel(key: string): string {
  return Object.hasOwn(TYPE_FIELD_LABELS, key)
    ? t(TYPE_FIELD_LABELS[key as keyof typeof TYPE_FIELD_LABELS])
    : humanise(key)
}

/**
 * Fields only some types carry, read off the results in hand: every key a
 * result of the chosen type returned in `fields`. Offered only when exactly one
 * group of results is chosen, because the same key can mean different things
 * on different types.
 */
export function typeSearchFields(
  results: readonly SearchResult[],
  group: SearchResultGroup | undefined,
): SheetbaseField[] {
  if (!group) return []
  const seen = new Map<string, SheetbaseField>()
  for (const result of results) {
    if (searchResultGroup(result) !== group) continue
    for (const [key, value] of Object.entries(result.fields)) {
      if (value === null || value === undefined || seen.has(key)) continue
      if (HIDDEN_TYPE_FIELDS.has(key)) continue
      seen.set(key, {
        id: `fields.${key}`,
        label: typeFieldLabel(key),
        dataType: dataTypeOf(value),
      })
    }
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}
