/**
 * What the peek card says about a record: a few facts read straight from the
 * same tables the record's own page reads, so a peek never opens or changes
 * anything. One reader per kind of page; a record the caller cannot see (row
 * level security) reads as `null` and the card falls back to what the link
 * itself named.
 */
import { isUuid } from '#/lib/identifier-resolution'
import type { DataClient } from '#/lib/data-client'
import {
  formatDate,
  formatRelativeTime,
  notebookDataClient,
} from '#/lib/notebook-data'
import { paneKind } from '#/lib/workspace-state'

export interface PeekFact {
  label: string
  value: string
}

export interface PeekSummary {
  identifier?: string
  title?: string
  /** "Experiment", "Cell bank", ...: finer than the pane kind when known. */
  kindLabel?: string
  status?: string
  /** One line of free text, when the record carries one. */
  description?: string
  facts: PeekFact[]
}

/** The reference a path names: the UUID or display id after the first segment. */
export function peekRef(href: string): string | null {
  const path = href.split(/[?#]/)[0] ?? ''
  const match = /^\/[^/]+\/([^/]+)/.exec(path)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

/** `snake_case` and `camelCase` keys and values, said as plain words. */
export function humanise(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const filter = (ref: string, displayColumn: string) =>
  isUuid(ref)
    ? `id=eq.${ref}`
    : `${displayColumn}=eq.${encodeURIComponent(ref)}`

const present = (fact: PeekFact | null): fact is PeekFact => fact !== null

const fact = (label: string, value: unknown): PeekFact | null => {
  if (value === null || value === undefined) return null
  const text = typeof value === 'string' ? value.trim() : String(value)
  return text ? { label, value: text } : null
}

const when = (label: string, iso: string | null | undefined) =>
  iso ? fact(label, formatRelativeTime(iso)) : null

const first = async <T>(
  client: DataClient,
  resource: string,
  query: string,
): Promise<T | null> =>
  (await client.list<T>(resource, `?${query}&limit=1`))[0] ?? null

async function memberNames(client: DataClient): Promise<Map<string, string>> {
  const rows = await client.list<{ user_id: string; name: string }>(
    'rpc/workspace_members_list',
    '?select=user_id,name',
  )
  return new Map(rows.map((row) => [row.user_id, row.name]))
}

async function projectTitle(
  client: DataClient,
  projectId: string | null | undefined,
): Promise<string | null> {
  if (!projectId) return null
  const row = await first<{ title: string; display_id: string | null }>(
    client,
    'projects',
    `id=eq.${projectId}&select=title,display_id`,
  )
  return row ? row.title : null
}

interface RecordRow {
  id: string
  identifier: string
  title: string
  kind: string
  status: string
  project_id: string | null
  tags: string[]
  planned_end: string | null
  reviewer_user_id: string | null
  created_by_user_id: string
  updated_at: string
  locked_at: string | null
  properties: Record<string, unknown> | null
}

const SCALAR_PROPERTIES = 3
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/

/** A property as a person reads it: dates as dates, the rest as written. */
const propertyText = (value: string | number) =>
  typeof value === 'string' && ISO_DATE.test(value) ? formatDate(value) : value

async function loadRecord(
  client: DataClient,
  ref: string,
): Promise<{ id: string; summary: PeekSummary } | null> {
  const row = await first<RecordRow>(
    client,
    'records',
    `${filter(ref, 'identifier')}&deleted_at=is.null&select=id,identifier,title,kind,status,project_id,tags,planned_end,reviewer_user_id,created_by_user_id,updated_at,locked_at,properties`,
  )
  if (!row) return null
  const [project, names] = await Promise.all([
    projectTitle(client, row.project_id),
    memberNames(client).catch(() => new Map<string, string>()),
  ])
  const properties = Object.entries(row.properties ?? {})
    .filter(
      ([, value]) =>
        (typeof value === 'string' && value.trim() !== '') ||
        typeof value === 'number',
    )
    .slice(0, SCALAR_PROPERTIES)
    .map(([key, value]) =>
      fact(humanise(key), propertyText(value as string | number)),
    )
  const summary: PeekSummary = {
    identifier: row.identifier,
    title: row.title,
    kindLabel: humanise(row.kind),
    status: row.status,
    facts: [
      fact('Project', project),
      fact('Owner', names.get(row.created_by_user_id)),
      fact(
        'Reviewer',
        row.reviewer_user_id ? names.get(row.reviewer_user_id) : null,
      ),
      row.planned_end ? fact('Planned end', formatDate(row.planned_end)) : null,
      ...properties,
      row.tags.length ? fact('Tags', row.tags.join(', ')) : null,
      row.locked_at
        ? fact('Signed', formatDate(row.locked_at))
        : when('Updated', row.updated_at),
    ].filter(present),
  }
  return { id: row.id, summary }
}

async function readRecord(
  client: DataClient,
  ref: string,
): Promise<PeekSummary | null> {
  return (await loadRecord(client, ref))?.summary ?? null
}

async function readProtocol(
  client: DataClient,
  ref: string,
): Promise<PeekSummary | null> {
  const loaded = await loadRecord(client, ref)
  if (!loaded) return null
  const base = loaded.summary
  const version = await first<{
    version: number
    status: string
    effective_at: string | null
    review_due_at: string | null
  }>(
    client,
    'protocol_versions',
    `protocol_record_id=eq.${loaded.id}&order=version.desc&select=version,status,effective_at,review_due_at`,
  )
  if (!version) return base
  return {
    ...base,
    facts: [
      fact('Version', `v${version.version} · ${humanise(version.status)}`),
      version.effective_at
        ? fact('Effective', formatDate(version.effective_at))
        : null,
      version.review_due_at
        ? fact('Review due', formatDate(version.review_due_at))
        : null,
      ...base.facts.filter((entry) => entry.label !== 'Updated'),
    ].filter(present),
  }
}

async function readProject(
  client: DataClient,
  ref: string,
): Promise<PeekSummary | null> {
  const row = await first<{
    title: string
    display_id: string | null
    status: string
    client_code: string | null
    client_name: string | null
    modality: string | null
    stage: string | null
    lead_name: string | null
    experiment_count: number
    last_activity_at: string | null
  }>(client, 'rpc/project_list_summary', filter(ref, 'display_id'))
  if (!row) return null
  return {
    identifier: row.display_id ?? undefined,
    title: row.title,
    status: row.status,
    facts: [
      fact(
        'Client',
        row.client_code
          ? `${row.client_code}${row.client_name ? ` · ${row.client_name}` : ''}`
          : 'Internal',
      ),
      fact('Stage', row.stage),
      fact('Modality', row.modality),
      fact('Lead', row.lead_name),
      fact('Experiments', row.experiment_count),
      when('Last activity', row.last_activity_at),
    ].filter(present),
  }
}

async function readDataset(
  client: DataClient,
  ref: string,
): Promise<PeekSummary | null> {
  const row = await first<{
    display_id: string
    name: string
    model: string | null
    project_id: string | null
    row_count: number
    issue_count: number
    review_state: string | null
    experiment_display_id: string | null
    updated_at: string
  }>(client, 'rpc/dataset_list_summary', filter(ref, 'display_id'))
  if (!row) return null
  return {
    identifier: row.display_id,
    title: row.name,
    status: row.review_state ?? undefined,
    facts: [
      fact('Model', row.model),
      fact('Experiment', row.experiment_display_id),
      fact('Rows', row.row_count),
      fact('Issues', row.issue_count > 0 ? row.issue_count : 'None flagged'),
      when('Updated', row.updated_at),
    ].filter(present),
  }
}

async function readAnalysis(
  client: DataClient,
  ref: string,
): Promise<PeekSummary | null> {
  const row = await first<{
    display_id: string | null
    name: string
    version: number
    charts: unknown
    source_revisions: unknown
    updated_at: string
  }>(
    client,
    'analysis_views',
    `${filter(ref, 'display_id')}&select=display_id,name,version,charts,source_revisions,updated_at`,
  )
  if (!row) return null
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0)
  return {
    identifier: row.display_id ?? undefined,
    title: row.name,
    facts: [
      fact('Version', `v${row.version}`),
      fact('Charts', count(row.charts)),
      fact('Cited revisions', count(row.source_revisions)),
      when('Updated', row.updated_at),
    ].filter(present),
  }
}

async function readInstrument(
  client: DataClient,
  ref: string,
): Promise<PeekSummary | null> {
  const row = await first<{
    display_id: string | null
    name: string
    instrument_type: string | null
    model: string | null
    vendor: string | null
    serial_number: string | null
    connection_status: string | null
    location: string | null
    retired_at: string | null
  }>(
    client,
    'instruments',
    `${filter(ref, 'display_id')}&select=display_id,name,instrument_type,model,vendor,serial_number,connection_status,location,retired_at`,
  )
  if (!row) return null
  return {
    identifier: row.display_id ?? undefined,
    title: row.name,
    status: row.retired_at ? 'retired' : (row.connection_status ?? undefined),
    facts: [
      fact('Type', row.instrument_type),
      fact(
        'Model',
        [row.vendor, row.model].filter(Boolean).join(' ') || undefined,
      ),
      fact('Serial', row.serial_number),
      fact('Location', row.location),
    ].filter(present),
  }
}

async function readSheet(
  client: DataClient,
  ref: string,
): Promise<PeekSummary | null> {
  const row = await first<{
    display_id: string | null
    name: string
    description: string | null
    lifecycle: string
    project_id: string | null
    updated_at: string
  }>(
    client,
    'sheet_instances',
    `${filter(ref, 'display_id')}&select=display_id,name,description,lifecycle,project_id,updated_at`,
  )
  if (!row) return null
  return {
    identifier: row.display_id ?? undefined,
    title: row.name,
    status: row.lifecycle,
    description: row.description ?? undefined,
    facts: [
      fact('Project', await projectTitle(client, row.project_id)),
      when('Updated', row.updated_at),
    ].filter(present),
  }
}

async function readPipeline(
  client: DataClient,
  ref: string,
): Promise<PeekSummary | null> {
  const row = await first<{
    display_id: string | null
    name: string
    description: string | null
    lifecycle: string
    revision: number
    updated_at: string
  }>(
    client,
    'pipeline_definitions',
    `${filter(ref, 'display_id')}&select=display_id,name,description,lifecycle,revision,updated_at`,
  )
  if (!row) return null
  return {
    identifier: row.display_id ?? undefined,
    title: row.name,
    status: row.lifecycle,
    description: row.description ?? undefined,
    facts: [
      fact('Revision', row.revision),
      when('Updated', row.updated_at),
    ].filter(present),
  }
}

async function readTemplate(
  client: DataClient,
  ref: string,
): Promise<PeekSummary | null> {
  const row = await first<{
    display_id: string | null
    name: string
    description: string | null
    lifecycle: string
    revision: number
    updated_at: string
  }>(
    client,
    'notebook_templates',
    `${filter(ref, 'display_id')}&select=display_id,name,description,lifecycle,revision,updated_at`,
  )
  if (!row) return null
  return {
    identifier: row.display_id ?? undefined,
    title: row.name,
    status: row.lifecycle,
    description: row.description ?? undefined,
    facts: [
      fact('Revision', row.revision),
      when('Updated', row.updated_at),
    ].filter(present),
  }
}

async function readModel(
  client: DataClient,
  ref: string,
): Promise<PeekSummary | null> {
  if (isUuid(ref)) {
    const row = await first<{
      key: string
      name: string
      description: string | null
      lifecycle: string
      updated_at: string
    }>(
      client,
      'dataset_schema_definitions',
      `id=eq.${ref}&select=key,name,description,lifecycle,updated_at`,
    )
    if (!row) return null
    return {
      identifier: row.key,
      title: row.name,
      kindLabel: 'Dataset model',
      status: row.lifecycle,
      description: row.description ?? undefined,
      facts: [when('Updated', row.updated_at)].filter(present),
    }
  }
  const row = await first<{
    key: string
    name: string
    description: string | null
    lifecycle: string
    current_version: number
    updated_at: string
  }>(
    client,
    'record_models',
    `key=eq.${encodeURIComponent(ref)}&select=key,name,description,lifecycle,current_version,updated_at`,
  )
  if (!row) return null
  return {
    identifier: row.key,
    title: row.name,
    kindLabel: 'Record model',
    status: row.lifecycle,
    description: row.description ?? undefined,
    facts: [
      fact('Version', `v${row.current_version}`),
      when('Updated', row.updated_at),
    ].filter(present),
  }
}

async function readReview(
  client: DataClient,
  ref: string,
): Promise<PeekSummary | null> {
  if (!isUuid(ref)) return null
  const revision = await first<{
    record_id: string
    reason: string
    created_at: string
    created_by_user_id: string
  }>(
    client,
    'revisions',
    `id=eq.${ref}&select=record_id,reason,created_at,created_by_user_id`,
  )
  if (!revision) return null
  const [record, names] = await Promise.all([
    first<{ identifier: string; title: string }>(
      client,
      'records',
      `id=eq.${revision.record_id}&select=identifier,title`,
    ),
    memberNames(client).catch(() => new Map<string, string>()),
  ])
  return {
    identifier: record?.identifier,
    title: record?.title,
    kindLabel: 'Revision',
    facts: [
      fact('Reason', humanise(revision.reason)),
      fact('Made by', names.get(revision.created_by_user_id)),
      fact('Made', formatDate(revision.created_at)),
    ].filter(present),
  }
}

const READERS: Partial<
  Record<
    string,
    (client: DataClient, ref: string) => Promise<PeekSummary | null>
  >
> = {
  experiment: readRecord,
  sample: readRecord,
  material: readRecord,
  protocol: readProtocol,
  template: readTemplate,
  dataset: readDataset,
  analysis: readAnalysis,
  project: readProject,
  instrument: readInstrument,
  sheet: readSheet,
  pipeline: readPipeline,
  model: readModel,
  review: readReview,
}

/** The summary for a record address, or null when nothing readable is there. */
export async function fetchPeekSummary(
  href: string,
  client: DataClient = notebookDataClient,
): Promise<PeekSummary | null> {
  const read = READERS[paneKind(href).key]
  const ref = peekRef(href)
  if (!read || !ref) return null
  return read(client, ref)
}
