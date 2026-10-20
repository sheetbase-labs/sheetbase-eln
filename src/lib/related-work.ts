/**
 * FIND-03 — Contextual discovery & related work.
 *
 * A unified "related work" aggregator built ONLY on existing RLS-filtered
 * reads: outgoing `record_links`, incoming links (`target_record_id` plus the
 * per-kind `link_type` patterns from templates/material/samples), bidirectional
 * lineage links, sheet-instance provenance columns, dataset schema
 * relationships, and shared project/model membership. PostgreSQL/RLS stays
 * authoritative — there is no shadow knowledge graph here, just one bounded
 * fan-out over the same PostgREST boundary as the rest of the app, with
 * labels and destinations resolved through `navigation.ts`.
 *
 * Every item carries a transparent human reason (`Linked by EXP-12`,
 * `Used as template in EXP-31`, `Same project`, …). Unresolvable or
 * invisible objects are dropped, never surfaced as errors.
 */
import { useQuery } from '@tanstack/react-query'

import type { DataClient } from './data-client'
import { fetchDatasetRelationshipsFor } from './dataset-explorer-data'
import { fetchLineageLinks, relationshipLabel } from './lineage-data'
import {
  datasetPath,
  notebookTemplatePath,
  projectPath,
  recordDestination,
  sheetPath,
} from './navigation'
import {
  fetchLinksForRecord,
  fetchProject,
  fetchRecord,
  fetchRecordsForProject,
  notebookDataClient,
  recordKindLabel,
} from './notebook-data'
import { fetchSheetInstance } from './sheet-instance-data'
import { fetchTemplateUsage } from './templates'

// ---------------------------------------------------------------------------
// Public shapes.
// ---------------------------------------------------------------------------

/** Canonical object classes related work can point at. */
export type RelatedWorkKind =
  'record' | 'dataset' | 'sheet' | 'template' | 'project'

export interface RelatedWorkItem {
  kind: RelatedWorkKind
  id: string
  /** Record kind for `record` items (drives `recordDestination`); else null. */
  recordKind: string | null
  label: string
  identifier: string | null
  /** Transparent human reason, e.g. `Linked by EXP-12`. */
  reason: string
  /** Canonical destination resolved through `navigation.ts`. */
  destination: string
}

/** Hard cap on the rendered list — discovery stays a compact panel. */
export const RELATED_WORK_LIMIT = 12

/** Per-source bound so one chatty source cannot dominate the fan-out. */
export const RELATED_WORK_SOURCE_LIMIT = 25

export const relatedWorkQueryKeys = {
  related: (kind: string, id: string) => ['related-work', kind, id] as const,
}

/**
 * Map a global-search result class onto the related-work kind space. Files
 * are file records, so they resolve through the record surface.
 */
export function searchResultToRelatedKind(
  resultType: string,
): RelatedWorkKind | null {
  switch (resultType) {
    case 'comment':
      return null
    case 'dataset':
      return 'dataset'
    case 'sheet':
      return 'sheet'
    case 'template':
      return 'template'
    case 'project':
      return 'project'
    default:
      return 'record'
  }
}

// ---------------------------------------------------------------------------
// Reason vocabulary — one place so the panel, tests and future surfaces
// agree on the transparent labels.
// ---------------------------------------------------------------------------

/** Reason for an outgoing link from the seed to `identifier`. */
export function outgoingLinkReason(
  linkType: string,
  identifier: string,
): string {
  switch (linkType) {
    case 'template':
      return `Created from template ${identifier}`
    case 'dataset':
    case 'analysis':
      return `Derived from dataset ${identifier}`
    case 'sample':
      return `Uses sample ${identifier}`
    case 'material':
      return `Uses material ${identifier}`
    case 'protocol':
      return `Uses protocol ${identifier}`
    case 'file':
      return `Has file ${identifier}`
    case 'booking':
      return `Booked ${identifier}`
    case 'general':
      return `Linked to ${identifier}`
    default: {
      const label = relationshipLabel(linkType)
      if (!label || label === linkType) return `Linked to ${identifier}`
      return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${identifier}`
    }
  }
}

/** Reason for an incoming link from `identifier` to the seed. */
export function incomingLinkReason(
  linkType: string,
  identifier: string,
): string {
  switch (linkType) {
    case 'template':
      return `Used as template in ${identifier}`
    case 'sample':
      return `Used as sample in ${identifier}`
    case 'material':
      return `Used as material in ${identifier}`
    case 'protocol':
      return `Used as protocol in ${identifier}`
    case 'dataset':
    case 'analysis':
      return `Used as dataset in ${identifier}`
    default:
      return `Linked by ${identifier}`
  }
}

// ---------------------------------------------------------------------------
// Pure aggregation core — deterministic, capped, fully testable without I/O.
// ---------------------------------------------------------------------------

/**
 * One unresolved candidate. `rank` orders relation strength: 0 for direct
 * record links, 1 for usage/provenance, 2 for cohort membership. Within a
 * rank the output is alphabetical so the panel never flickers between
 * identical-strength candidates.
 */
export interface RelatedWorkCandidate {
  kind: RelatedWorkKind
  id: string
  recordKind?: string | null
  label: string
  identifier?: string | null
  reason: string
  rank: number
}

/** Canonical destination for a related item (navigation.ts only). */
export function relatedDestination(
  kind: RelatedWorkKind,
  id: string,
  recordKind: string | null = null,
): string {
  switch (kind) {
    case 'dataset':
      return datasetPath(id)
    case 'sheet':
      return sheetPath(id)
    case 'template':
      return notebookTemplatePath(id)
    case 'project':
      return projectPath(id)
    default:
      return recordDestination(recordKind ?? '', id)
  }
}

/** Human type label for a related item (record kinds reuse the canonical map). */
export function relatedKindLabel(
  kind: RelatedWorkKind,
  recordKind: string | null = null,
): string {
  if (kind === 'record') return recordKindLabel(recordKind ?? 'record')
  switch (kind) {
    case 'dataset':
      return 'Dataset'
    case 'sheet':
      return 'Sheet'
    case 'template':
      return 'Template'
    case 'project':
      return 'Project'
  }
}

/**
 * Assemble the final panel list: drop the seed itself and unlabelled
 * candidates, dedupe by kind+id keeping the strongest (lowest-rank) reason,
 * sort deterministically (rank, kind, label, id) and cap.
 */
export function assembleRelatedWork(
  seedKind: RelatedWorkKind,
  seedId: string,
  candidates: RelatedWorkCandidate[],
): RelatedWorkItem[] {
  const strongest = new Map<string, RelatedWorkCandidate>()
  for (const candidate of candidates) {
    if (!candidate.id || !candidate.label) continue
    if (candidate.kind === seedKind && candidate.id === seedId) continue
    const key = `${candidate.kind}:${candidate.id}`
    const prev = strongest.get(key)
    if (!prev || candidate.rank < prev.rank) strongest.set(key, candidate)
  }
  return [...strongest.values()]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
        a.label.localeCompare(b.label) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, RELATED_WORK_LIMIT)
    .map((candidate) => ({
      kind: candidate.kind,
      id: candidate.id,
      recordKind: candidate.recordKind ?? null,
      label: candidate.label,
      identifier: candidate.identifier ?? null,
      reason: candidate.reason,
      destination: relatedDestination(
        candidate.kind,
        candidate.id,
        candidate.recordKind ?? null,
      ),
    }))
}

// ---------------------------------------------------------------------------
// Live fetch — one bounded fan-out over existing RLS-filtered readers.
// ---------------------------------------------------------------------------

interface IncomingLinkWire {
  id: string
  source_record_id: string
  target_kind: string
  target_identifier: string
  link_type: string
  created_at: string
}

interface RecordLabelWire {
  id: string
  kind: string
  identifier: string
  title: string
  archived_at: string | null
  deleted_at: string | null
}

interface SheetProvenanceWire {
  id: string
  name: string
  lifecycle: string
  notebook_record_id: string | null
  duplicated_from_instance_id: string | null
  source_definition_version_id: string | null
}

interface DatasetIdentityWire {
  id: string
  name: string
  lifecycle: string
  schema_version_id: string
}

interface TemplateLabelWire {
  id: string
  key: string
  name: string
  lifecycle: string
}

/** Never let one source failure poison the whole panel. */
async function quiet<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise
  } catch {
    return fallback
  }
}

function inFilter(ids: readonly string[]): string {
  return `in.(${ids.map((id) => encodeURIComponent(id)).join(',')})`
}

/**
 * Batch-resolve record ids to openable labels. Records that are gone,
 * archived, deleted or simply invisible under RLS come back absent and are
 * dropped by the caller — never rendered as stubs.
 */
async function resolveRecordLabels(
  client: DataClient,
  ids: readonly string[],
): Promise<Map<string, { kind: string; identifier: string; title: string }>> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return new Map()
  const rows = await quiet(
    client.list<RecordLabelWire>(
      'records',
      `?id=${inFilter(unique)}&select=id,kind,identifier,title,archived_at,deleted_at`,
    ),
    [],
  )
  const byId = new Map<
    string,
    { kind: string; identifier: string; title: string }
  >()
  for (const row of rows) {
    if (row.archived_at !== null || row.deleted_at !== null) continue
    byId.set(row.id, {
      kind: row.kind,
      identifier: row.identifier,
      title: row.title,
    })
  }
  return byId
}

/** Resolve a dataset target held only by name (links carry no dataset id). */
async function resolveDatasetByName(
  client: DataClient,
  name: string,
): Promise<{ id: string; name: string } | null> {
  if (!name) return null
  const rows = await quiet(
    client.list<DatasetIdentityWire>(
      'datasets',
      `?name=eq.${encodeURIComponent(name)}&select=id,name,lifecycle&limit=1`,
    ),
    [],
  )
  const row = rows.at(0)
  if (!row || row.lifecycle !== 'active') return null
  return { id: row.id, name: row.name }
}

/**
 * Fetch related work for any canonical object. Every read goes through the
 * same PostgREST boundary (and RLS) as the rest of the app; anything the
 * caller cannot see is absent and therefore dropped. Never throws — an
 * unresolvable seed yields an empty list so the panel stays silent.
 */
export async function fetchRelatedWork(
  kind: RelatedWorkKind,
  id: string,
  client: DataClient = notebookDataClient,
): Promise<RelatedWorkItem[]> {
  if (!id) return []
  try {
    switch (kind) {
      case 'record':
        return await fetchRelatedForRecord(client, id)
      case 'dataset':
        return await fetchRelatedForDataset(client, id)
      case 'sheet':
        return await fetchRelatedForSheet(client, id)
      case 'template':
        return await fetchRelatedForTemplate(client, id)
      case 'project':
        return await fetchRelatedForProject(client, id)
    }
  } catch {
    return []
  }
}

// --- Record seeds ----------------------------------------------------------

async function fetchRelatedForRecord(
  client: DataClient,
  recordId: string,
): Promise<RelatedWorkItem[]> {
  const seed = await quiet(fetchRecord(client, recordId), null)
  if (!seed || seed.archivedAt !== null || seed.deletedAt !== null) return []

  const encodedId = encodeURIComponent(recordId)
  const linkSelect =
    'select=id,source_record_id,target_kind,target_identifier,link_type,created_at'
  const [outgoing, incoming, lineageLinks, incomingByIdentifier, sheets] =
    await Promise.all([
      quiet(fetchLinksForRecord(client, recordId), []),
      quiet(
        client.list<IncomingLinkWire>(
          'record_links',
          `?target_record_id=eq.${encodedId}&order=created_at.desc&limit=${RELATED_WORK_SOURCE_LIMIT}&${linkSelect}`,
        ),
        [],
      ),
      // Bidirectional lineage links (source or target in set) — the same
      // rows as above viewed both ways; `assembleRelatedWork` dedupes to
      // the strongest reason per object.
      quiet(fetchLineageLinks(client, [recordId]), []),
      // Reagent-style links address the target by identifier, not id.
      seed.identifier
        ? quiet(
            client.list<IncomingLinkWire>(
              'record_links',
              `?target_identifier=eq.${encodeURIComponent(seed.identifier)}&order=created_at.desc&limit=${RELATED_WORK_SOURCE_LIMIT}&${linkSelect}`,
            ),
            [],
          )
        : Promise.resolve([] as IncomingLinkWire[]),
      quiet(
        client.list<SheetProvenanceWire>(
          'sheet_instances',
          `?notebook_record_id=eq.${encodedId}&select=id,name,lifecycle,notebook_record_id,duplicated_from_instance_id,source_definition_version_id`,
        ),
        [],
      ),
    ])

  // Outgoing record targets resolve by id; dataset targets carry only a
  // name and resolve separately below.
  const outRecords: { id: string; recordKind: string; reason: string }[] = []
  const outDatasets: { name: string; reason: string }[] = []
  const pushOutgoing = (
    targetRecordId: string | null,
    targetKind: string,
    targetIdentifier: string,
    linkType: string,
  ) => {
    const reason = outgoingLinkReason(linkType, targetIdentifier)
    if (targetRecordId && targetRecordId !== recordId) {
      outRecords.push({ id: targetRecordId, recordKind: targetKind, reason })
    } else if (
      !targetRecordId &&
      targetKind === 'dataset' &&
      targetIdentifier
    ) {
      outDatasets.push({ name: targetIdentifier, reason })
    }
  }
  for (const link of outgoing) {
    pushOutgoing(
      link.targetRecordId,
      link.targetKind,
      link.targetIdentifier,
      link.linkType,
    )
  }
  for (const link of lineageLinks) {
    if (link.source_record_id === recordId) {
      pushOutgoing(
        link.target_record_id,
        link.target_kind,
        link.target_identifier,
        link.link_type,
      )
    }
  }

  // Incoming sources always carry a source record id; first-seen link type
  // wins so the direct incoming query outranks the by-identifier fallback.
  const incomingLinkType = new Map<string, string>()
  const noteIncoming = (sourceId: string, linkType: string) => {
    if (!sourceId || sourceId === recordId) return
    if (!incomingLinkType.has(sourceId))
      incomingLinkType.set(sourceId, linkType)
  }
  for (const link of incoming)
    noteIncoming(link.source_record_id, link.link_type)
  for (const link of lineageLinks) {
    if (link.target_record_id === recordId) {
      noteIncoming(link.source_record_id, link.link_type)
    }
  }
  for (const link of incomingByIdentifier) {
    noteIncoming(link.source_record_id, link.link_type)
  }

  const [recordLabels, datasetTargets, projectRecords] = await Promise.all([
    resolveRecordLabels(client, [
      ...outRecords.map((t) => t.id),
      ...incomingLinkType.keys(),
    ]),
    Promise.all(
      outDatasets.map(async (t) => ({
        resolved: await resolveDatasetByName(client, t.name),
        reason: t.reason,
      })),
    ),
    seed.projectId
      ? quiet(fetchRecordsForProject(client, seed.projectId), [])
      : Promise.resolve([]),
  ])

  const candidates: RelatedWorkCandidate[] = []

  for (const target of outRecords) {
    const resolved = recordLabels.get(target.id)
    if (!resolved) continue
    candidates.push({
      kind: 'record',
      id: target.id,
      recordKind: resolved.kind,
      label: resolved.title,
      identifier: resolved.identifier,
      reason: target.reason,
      rank: 0,
    })
  }

  for (const [sourceId, linkType] of incomingLinkType) {
    const resolved = recordLabels.get(sourceId)
    if (!resolved) continue
    candidates.push({
      kind: 'record',
      id: sourceId,
      recordKind: resolved.kind,
      label: resolved.title,
      identifier: resolved.identifier,
      reason: incomingLinkReason(linkType, resolved.identifier),
      rank: 0,
    })
  }

  for (const { resolved, reason } of datasetTargets) {
    if (!resolved) continue
    candidates.push({
      kind: 'dataset',
      id: resolved.id,
      label: resolved.name,
      reason,
      rank: 1,
    })
  }

  for (const sheet of sheets) {
    if (sheet.lifecycle !== 'active') continue
    candidates.push({
      kind: 'sheet',
      id: sheet.id,
      label: sheet.name,
      reason: 'Sheet for this record',
      rank: 1,
    })
  }

  // Shared project membership fills the tail — bounded so a large project
  // cannot crowd out direct links (the final cap keeps the strongest).
  for (const record of projectRecords.slice(0, RELATED_WORK_SOURCE_LIMIT)) {
    if (record.id === recordId) continue
    if (record.archivedAt !== null || record.deletedAt != null) continue
    candidates.push({
      kind: 'record',
      id: record.id,
      recordKind: record.kind,
      label: record.title,
      identifier: record.identifier,
      reason: 'Same project',
      rank: 2,
    })
  }

  return assembleRelatedWork('record', recordId, candidates)
}

// --- Dataset seeds ---------------------------------------------------------

async function fetchRelatedForDataset(
  client: DataClient,
  datasetId: string,
): Promise<RelatedWorkItem[]> {
  const encodedId = encodeURIComponent(datasetId)
  const [seedRows, incoming] = await Promise.all([
    quiet(
      client.list<DatasetIdentityWire>(
        'datasets',
        `?id=eq.${encodedId}&select=id,name,lifecycle,schema_version_id&limit=1`,
      ),
      [],
    ),
    quiet(
      client.list<IncomingLinkWire>(
        'record_links',
        `?target_record_id=eq.${encodedId}&order=created_at.desc&limit=${RELATED_WORK_SOURCE_LIMIT}` +
          `&select=id,source_record_id,target_kind,target_identifier,link_type,created_at`,
      ),
      [],
    ),
  ])
  const seed = seedRows.at(0)
  if (!seed || seed.lifecycle !== 'active') return []

  // Schema-mediated sibling datasets: dataset → schema version → schema →
  // relationships → sibling schemas → sibling datasets (all existing reads).
  const siblingCandidates: RelatedWorkCandidate[] = []
  if (seed.schema_version_id) {
    const versions = await quiet(
      client.list<{ id: string; schema_id: string }>(
        'dataset_schema_versions',
        `?id=eq.${encodeURIComponent(seed.schema_version_id)}&select=id,schema_id&limit=1`,
      ),
      [],
    )
    const schemaId = versions[0]?.schema_id ?? null
    if (schemaId) {
      const relationships = await quiet(
        fetchDatasetRelationshipsFor(client, schemaId),
        [],
      )
      const siblingSchemaIds = [
        ...new Set(
          relationships.flatMap((rel) => [
            rel.source_schema_id,
            rel.target_schema_id,
          ]),
        ),
      ].filter((id) => id !== schemaId)
      if (siblingSchemaIds.length > 0) {
        const siblingVersions = await quiet(
          client.list<{ id: string; schema_id: string }>(
            'dataset_schema_versions',
            `?schema_id=${inFilter(siblingSchemaIds)}&select=id,schema_id`,
          ),
          [],
        )
        const versionIds = siblingVersions.map((v) => v.id)
        if (versionIds.length > 0) {
          const siblings = await quiet(
            client.list<DatasetIdentityWire>(
              'datasets',
              `?schema_version_id=${inFilter(versionIds)}&select=id,name,lifecycle&limit=${RELATED_WORK_SOURCE_LIMIT}`,
            ),
            [],
          )
          for (const sibling of siblings) {
            if (sibling.id === datasetId || sibling.lifecycle !== 'active')
              continue
            siblingCandidates.push({
              kind: 'dataset',
              id: sibling.id,
              label: sibling.name,
              reason: `Shares schema with ${seed.name}`,
              rank: 1,
            })
          }
        }
      }
    }
  }

  const sourceLabels = await resolveRecordLabels(
    client,
    incoming
      .map((link) => link.source_record_id)
      .filter((id) => id !== datasetId),
  )
  const candidates: RelatedWorkCandidate[] = [...siblingCandidates]
  for (const link of incoming) {
    if (link.source_record_id === datasetId) continue
    const resolved = sourceLabels.get(link.source_record_id)
    if (!resolved) continue
    candidates.push({
      kind: 'record',
      id: link.source_record_id,
      recordKind: resolved.kind,
      label: resolved.title,
      identifier: resolved.identifier,
      reason: incomingLinkReason(link.link_type, resolved.identifier),
      rank: 0,
    })
  }
  return assembleRelatedWork('dataset', datasetId, candidates)
}

// --- Sheet seeds -----------------------------------------------------------

async function fetchRelatedForSheet(
  client: DataClient,
  sheetId: string,
): Promise<RelatedWorkItem[]> {
  const seed = await quiet(fetchSheetInstance(sheetId, client), null)
  if (!seed || seed.lifecycle !== 'active') return []
  const candidates: RelatedWorkCandidate[] = []

  if (seed.notebookRecordId) {
    const record = await quiet(fetchRecord(client, seed.notebookRecordId), null)
    if (record && record.archivedAt === null && record.deletedAt === null) {
      candidates.push({
        kind: 'record',
        id: record.id,
        recordKind: record.kind,
        label: record.title,
        identifier: record.identifier,
        reason: `Sheet for record ${record.identifier}`,
        rank: 1,
      })
    }
  }

  if (seed.duplicatedFromInstanceId) {
    const origin = await quiet(
      fetchSheetInstance(seed.duplicatedFromInstanceId, client),
      null,
    )
    if (origin && origin.lifecycle === 'active') {
      candidates.push({
        kind: 'sheet',
        id: origin.id,
        label: origin.name,
        reason: `Duplicated from sheet ${origin.name}`,
        rank: 1,
      })
    }
  }

  // Shared model membership: sheets instantiated from the same definition.
  if (seed.sourceDefinitionVersionId) {
    const siblings = await quiet(
      client.list<SheetProvenanceWire>(
        'sheet_instances',
        `?source_definition_version_id=eq.${encodeURIComponent(seed.sourceDefinitionVersionId)}` +
          `&limit=${RELATED_WORK_SOURCE_LIMIT}&select=id,name,lifecycle,notebook_record_id,duplicated_from_instance_id,source_definition_version_id`,
      ),
      [],
    )
    for (const sibling of siblings) {
      if (sibling.id === sheetId || sibling.lifecycle !== 'active') continue
      candidates.push({
        kind: 'sheet',
        id: sibling.id,
        label: sibling.name,
        reason: 'Same model',
        rank: 2,
      })
    }
  }

  return assembleRelatedWork('sheet', sheetId, candidates)
}

// --- Template seeds --------------------------------------------------------

async function fetchRelatedForTemplate(
  client: DataClient,
  templateId: string,
): Promise<RelatedWorkItem[]> {
  const encodedId = encodeURIComponent(templateId)
  const [usage, outgoing, incoming, templateRows] = await Promise.all([
    quiet(fetchTemplateUsage(client, templateId), []),
    quiet(fetchLinksForRecord(client, templateId), []),
    quiet(
      client.list<IncomingLinkWire>(
        'record_links',
        `?target_record_id=eq.${encodedId}&order=created_at.desc&limit=${RELATED_WORK_SOURCE_LIMIT}` +
          `&select=id,source_record_id,target_kind,target_identifier,link_type,created_at`,
      ),
      [],
    ),
    quiet(
      client.list<TemplateLabelWire>(
        'notebook_templates',
        `?id=eq.${encodedId}&select=id,key,name,lifecycle&limit=1`,
      ),
      [],
    ),
  ])
  const template = templateRows.at(0)
  if (template && template.lifecycle !== 'active') return []

  const usageIds = new Set(
    usage.map((u) => u.recordId).filter((id) => id !== templateId),
  )
  const incomingIds = incoming
    .map((link) => link.source_record_id)
    .filter((id) => id !== templateId && !usageIds.has(id))
  const outgoingIds = outgoing
    .map((link) => link.targetRecordId)
    .filter((id): id is string => Boolean(id) && id !== templateId)
  const labels = await resolveRecordLabels(client, [
    ...usageIds,
    ...incomingIds,
    ...outgoingIds,
  ])

  const incomingLinkType = new Map(
    incoming.map((link) => [link.source_record_id, link.link_type] as const),
  )
  const candidates: RelatedWorkCandidate[] = []
  for (const recordId of usageIds) {
    const resolved = labels.get(recordId)
    if (!resolved) continue
    candidates.push({
      kind: 'record',
      id: recordId,
      recordKind: resolved.kind,
      label: resolved.title,
      identifier: resolved.identifier,
      reason: `Used as template in ${resolved.identifier}`,
      rank: 0,
    })
  }
  for (const sourceId of incomingIds) {
    const resolved = labels.get(sourceId)
    if (!resolved) continue
    candidates.push({
      kind: 'record',
      id: sourceId,
      recordKind: resolved.kind,
      label: resolved.title,
      identifier: resolved.identifier,
      reason: incomingLinkReason(
        incomingLinkType.get(sourceId) ?? 'general',
        resolved.identifier,
      ),
      rank: 0,
    })
  }
  for (const link of outgoing) {
    if (!link.targetRecordId || link.targetRecordId === templateId) continue
    const resolved = labels.get(link.targetRecordId)
    if (!resolved) continue
    candidates.push({
      kind: 'record',
      id: link.targetRecordId,
      recordKind: resolved.kind,
      label: resolved.title,
      identifier: resolved.identifier,
      reason: outgoingLinkReason(link.linkType, link.targetIdentifier),
      rank: 0,
    })
  }
  return assembleRelatedWork('template', templateId, candidates)
}

// --- Project seeds ---------------------------------------------------------

async function fetchRelatedForProject(
  client: DataClient,
  projectId: string,
): Promise<RelatedWorkItem[]> {
  const [project, records] = await Promise.all([
    quiet(fetchProject(client, projectId), null),
    quiet(fetchRecordsForProject(client, projectId), []),
  ])
  if (!project) return []
  const candidates: RelatedWorkCandidate[] = []
  for (const record of records.slice(0, RELATED_WORK_SOURCE_LIMIT)) {
    if (record.archivedAt !== null || record.deletedAt != null) continue
    candidates.push({
      kind: 'record',
      id: record.id,
      recordKind: record.kind,
      label: record.title,
      identifier: record.identifier,
      reason: 'In this project',
      rank: 1,
    })
  }
  return assembleRelatedWork('project', projectId, candidates)
}

// ---------------------------------------------------------------------------
// Hook — the same declarative shape as the notebook queries.
// ---------------------------------------------------------------------------

/** Reactive related-work list for panels; silent while the id is absent. */
export function useRelatedWork(
  kind: RelatedWorkKind,
  id: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: relatedWorkQueryKeys.related(kind, id ?? 'none'),
    queryFn: () => fetchRelatedWork(kind, id as string),
    enabled: enabled && Boolean(id),
    staleTime: 10_000,
  })
}
