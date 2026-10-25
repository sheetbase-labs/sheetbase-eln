/**
 * AI-01 — Context Assembly Contract.
 *
 * Assembles the permitted canonical Sheetbase context for intelligent
 * features into a versioned envelope that AI-02 (retrieval/citation) and
 * AI-03 (model gateway) will consume. This module assembles context only:
 *
 * - No model invocation, no provider code (AI-03's domain).
 * - No persistence: assembly is a pure function of RLS-filtered reads. It
 *   never inserts, patches, deletes, or calls mutating RPCs, and it creates
 *   no AI-only data store.
 * - No UI state scraping: every section is resolved from stable IDs through
 *   the existing RLS-filtered fetchers (`records`, sheet/dataset/analysis
 *   resolvers) and the `query_dataset_rows` RPC.
 *
 * Permission model: context never grants access beyond the requesting actor.
 * Each object is resolved through the actor's own `DataClient`, so PostgreSQL
 * RLS is the permission check — an invisible row reads as absent and becomes
 * an explicit omission marker, never silent and never leaked. Where the wire
 * shape carries `workspace_id`, assembly additionally verifies it matches the
 * requested workspace before any material is summarised (fail closed when the
 * workspace is ambiguous or mismatched).
 *
 * Version/evidence model: pinned versions are stated with their evidence
 * (Dataset Version pins carry row counts/checksums; frozen analysis blocks
 * carry their immutable provenance). Anything read live is marked `live`
 * explicitly. A requester-supplied `pinnedVersionId` on a Dataset withholds
 * live row sampling so pinned and live state are never mixed.
 *
 * Budget model: bounded assembly in well-defined units, no tokenizer
 * dependency. Units are UTF-16 code units (`String.length`, documented as an
 * approximate proxy at ~4 chars per English token), sections (one summary
 * block per object facet), rows (sampled Dataset rows), and objects
 * (requested refs). Every cut is explicit: truncated sections carry
 * `truncated: true` and name what was cut; refs dropped by a budget become
 * `budget_exceeded` omissions naming the ref and the exhausted budget.
 */

import { fetchAnalysisDefinition } from './analysis-definitions-data'
import type { DataClient } from './data-client'
import {
  fetchDatasetRowPage,
  fetchDatasetSummaries,
} from './dataset-explorer-data'
import { redact } from './logger'
import { datasetPath, recordDestination, sheetPath } from './navigation'
import {
  fetchBlocksForRecord,
  fetchLinksForRecord,
  fetchProject,
  fetchRecord,
} from './notebook-data'
import type { NotebookBlock } from './notebook-data'
import { extractBlockText } from './search'
import {
  fetchSheetDefinition,
  fetchSheetDefinitionVersion,
} from './sheet-definition-data'
import { fetchSheetInstance } from './sheet-instance-data'

/** Envelope format version. Bump when the envelope shape changes. */
export const AI_CONTEXT_VERSION = 1 as const

/** The requesting actor. Assembly runs with this actor's reads only. */
export interface AiContextActor {
  kind: 'user' | 'service_credential'
  id: string
}

/** Object classes assembly can summarise, by stable ID. */
export type AiObjectRefKind =
  'record' | 'notebook' | 'sheet' | 'dataset' | 'analysis'

export const AI_OBJECT_REF_KINDS: readonly AiObjectRefKind[] = [
  'record',
  'notebook',
  'sheet',
  'dataset',
  'analysis',
]

/** One requested object. IDs are canonical stable UUIDs. */
export interface AiObjectRef {
  kind: AiObjectRefKind
  id: string
  /**
   * Optional immutable pin asserted by the caller (Dataset Version ID,
   * Sheet Definition Version ID, …). Stated verbatim in `pins`; for
   * Datasets it additionally withholds live row sampling so pinned and
   * live state are never mixed.
   */
  pinnedVersionId?: string | null
  /** Sample live Dataset rows (datasets only, no pin). Default false. */
  includeSampleRows?: boolean
}

/**
 * Assembly budgets. Units: `chars` are UTF-16 code units (approximate proxy
 * for tokens, ~4 chars per English token — not a tokenizer); `sections` are
 * per-object summary blocks; `rows` are sampled Dataset rows; `objects` are
 * requested refs.
 */
export interface AiContextBudgets {
  maxObjects: number
  maxSectionsPerObject: number
  maxCharsPerSection: number
  maxCharsTotal: number
  maxRowsPerDataset: number
}

export const DEFAULT_AI_CONTEXT_BUDGETS: AiContextBudgets = {
  maxObjects: 12,
  maxSectionsPerObject: 20,
  maxCharsPerSection: 2000,
  maxCharsTotal: 24000,
  maxRowsPerDataset: 10,
}

export type AiFreshness = 'live' | 'pinned'

export type AiVersionPinKind =
  | 'dataset_version'
  | 'analysis_freeze'
  | 'sheet_definition_version'
  | 'asserted'

export interface AiVersionPin {
  kind: AiVersionPinKind
  /** Stable ID of the pinned immutable state. */
  id: string
  /** Human-readable evidence (row counts, checksums, revisions). */
  detail: string
}

export interface AiContextSection {
  heading: string
  body: string
  /** True when the body was cut to fit `maxCharsPerSection`. */
  truncated: boolean
}

export interface AiContextObject {
  kind: AiObjectRefKind
  id: string
  title: string
  /** Product deep link, or null when the class has no product surface. */
  deepLink: string | null
  freshness: AiFreshness
  pins: AiVersionPin[]
  sections: AiContextSection[]
  /** True when sections were dropped to fit `maxSectionsPerObject`. */
  truncated: boolean
}

export type AiOmissionReason =
  'not_visible' | 'wrong_workspace' | 'unsupported_kind' | 'budget_exceeded'

export interface AiContextOmission {
  kind: string
  id: string
  reason: AiOmissionReason
  /** Names the ref and the cause; never carries object material. */
  detail: string
}

export interface AiContextBudgetUsage {
  chars: number
  sections: number
  rows: number
  objects: number
}

export interface AiContextEnvelope {
  version: typeof AI_CONTEXT_VERSION
  actor: AiContextActor
  workspace: {
    id: string
    project: { id: string; title: string } | null
  }
  objects: AiContextObject[]
  omissions: AiContextOmission[]
  budgets: {
    applied: AiContextBudgets
    usage: AiContextBudgetUsage
  }
}

export interface AssembleAiContextInput {
  workspaceId: string
  projectId?: string | null
  objectRefs: Array<AiObjectRef | null | undefined>
  budgets?: Partial<AiContextBudgets>
}

// ---------------------------------------------------------------------------
// Budget helpers.
// ---------------------------------------------------------------------------

function resolveBudgets(partial?: Partial<AiContextBudgets>): AiContextBudgets {
  const pick = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : fallback
  const defaults = DEFAULT_AI_CONTEXT_BUDGETS
  return {
    maxObjects: pick(partial?.maxObjects, defaults.maxObjects),
    maxSectionsPerObject: pick(
      partial?.maxSectionsPerObject,
      defaults.maxSectionsPerObject,
    ),
    maxCharsPerSection: pick(
      partial?.maxCharsPerSection,
      defaults.maxCharsPerSection,
    ),
    maxCharsTotal: pick(partial?.maxCharsTotal, defaults.maxCharsTotal),
    maxRowsPerDataset: pick(
      partial?.maxRowsPerDataset,
      defaults.maxRowsPerDataset,
    ),
  }
}

function truncateSection(
  heading: string,
  body: string,
  maxChars: number,
): AiContextSection {
  if (body.length <= maxChars) return { heading, body, truncated: false }
  const marker = `[truncated: section '${heading}' exceeded ${maxChars} chars; remainder omitted]`
  const kept = Math.max(0, maxChars - marker.length - 1)
  return {
    heading,
    body: `${body.slice(0, kept)}\n${marker}`,
    truncated: true,
  }
}

// ---------------------------------------------------------------------------
// Small redacted formatters. Free-form payloads pass through the canonical
// logger redact() so secret-shaped keys never reach model context.
// ---------------------------------------------------------------------------

function scalarSummary(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value === '' ? '—' : value
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value)
  try {
    const serialized: unknown = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized : '—'
  } catch {
    return '[unserialisable value]'
  }
}

function summariseProperties(
  properties: Record<string, unknown>,
  maxEntries = 30,
): { body: string; dropped: number } {
  const clean = redact(properties)
  const keys = Object.keys(clean)
  const shown = keys.slice(0, maxEntries).map((key) => {
    const value = scalarSummary(clean[key])
    return `${key}: ${value}`
  })
  const dropped = keys.length - shown.length
  const body = shown.length > 0 ? shown.join('\n') : '(no properties)'
  return {
    body:
      dropped > 0
        ? `${body}\n[omitted: ${dropped} further properties over the ${maxEntries}-entry summary cap]`
        : body,
    dropped,
  }
}

interface FrozenProvenance {
  datasetId: string
  datasetVersionId: string
  rowCount: number
  checksum: string
}

function frozenProvenanceOf(block: NotebookBlock): FrozenProvenance[] {
  const payload = block.payload as {
    frozen?: {
      datasetProvenance?: Array<{
        datasetId?: unknown
        datasetVersionId?: unknown
        rowCount?: unknown
        checksum?: unknown
      }>
    } | null
  }
  const provenance = payload.frozen?.datasetProvenance
  if (!Array.isArray(provenance)) return []
  return provenance.flatMap((entry) => {
    if (
      typeof entry.datasetId !== 'string' ||
      typeof entry.datasetVersionId !== 'string' ||
      typeof entry.rowCount !== 'number' ||
      typeof entry.checksum !== 'string'
    )
      return []
    return [
      {
        datasetId: entry.datasetId,
        datasetVersionId: entry.datasetVersionId,
        rowCount: entry.rowCount,
        checksum: entry.checksum,
      },
    ]
  })
}

function blockSummary(block: NotebookBlock): {
  body: string
  pins: AiVersionPin[]
} {
  let text: string
  try {
    text = extractBlockText(block.type, block.payload)
  } catch {
    text = '[unreadable block payload]'
  }
  const pins: AiVersionPin[] = []
  let evidence = 'live: current draft content'
  if (block.type === 'analysis') {
    const frozen = frozenProvenanceOf(block)
    if (frozen.length > 0) {
      for (const entry of frozen) {
        pins.push({
          kind: 'analysis_freeze',
          id: entry.datasetVersionId,
          detail: `dataset ${entry.datasetId}: ${entry.rowCount} rows, checksum ${entry.checksum}`,
        })
      }
      evidence = `pinned: frozen analysis over ${frozen.map((e) => `dataset version ${e.datasetVersionId} (${e.rowCount} rows, checksum ${e.checksum})`).join('; ')}`
    } else {
      const payload = block.payload as { definitionId?: unknown }
      evidence =
        typeof payload.definitionId === 'string'
          ? `live: draft analysis definition ${payload.definitionId} (unfrozen — results may change)`
          : 'live: draft analysis (unfrozen — results may change)'
    }
  }
  const clean = redact(text)
  const body = `[${block.type} block ${block.id}]\n${evidence}\n${typeof clean === 'string' ? clean : scalarSummary(clean)}`
  return { body, pins }
}

// ---------------------------------------------------------------------------
// Per-kind resolvers. Each returns either a summarised object or an omission.
// The RLS-filtered read is the permission check: an invisible row reads as
// absent. Workspace verification happens BEFORE any material is summarised.
// ---------------------------------------------------------------------------

type ResolvedObject =
  | {
      ok: true
      object: Omit<AiContextObject, 'sections'> & {
        sections: Array<{ heading: string; body: string }>
      }
      rowsSampled?: number
    }
  | { ok: false; omission: AiContextOmission }

function notVisible(kind: string, id: string): AiContextOmission {
  return {
    kind,
    id,
    reason: 'not_visible',
    detail: `object ${kind}:${id} not found or not visible to the requesting actor; omitted without material`,
  }
}

async function resolveRecord(
  client: DataClient,
  ref: AiObjectRef,
  workspaceId: string,
): Promise<ResolvedObject> {
  const record = await fetchRecord(client, ref.id)
  if (!record) return { ok: false, omission: notVisible(ref.kind, ref.id) }
  const wire = (await client.list<{ workspace_id?: string }>(
    'records',
    `?id=eq.${encodeURIComponent(ref.id)}&select=workspace_id&limit=1`,
  )) as Array<{ workspace_id?: string }>
  // fetchRecord is the canonical resolver under RLS; the narrow workspace
  // projection confirms the row belongs to the requested workspace. When the
  // workspace is unverifiable or mismatched, fail closed.
  const ownerWorkspace = wire[0]?.workspace_id
  if (ownerWorkspace !== workspaceId) {
    return {
      ok: false,
      omission: {
        kind: ref.kind,
        id: ref.id,
        reason: 'wrong_workspace',
        detail: `object ${ref.kind}:${ref.id} is not in workspace ${workspaceId}; omitted without material`,
      },
    }
  }
  const { body: propsBody } = summariseProperties(record.properties)
  const sections = [
    {
      heading: 'identity',
      body: [
        `identifier: ${record.identifier}`,
        `title: ${record.title}`,
        `kind: ${record.kind}`,
        `status: ${record.status}`,
        `tags: ${record.tags.length > 0 ? record.tags.join(', ') : '(none)'}`,
        record.archivedAt ? `archived: ${record.archivedAt}` : 'archived: no',
      ].join('\n'),
    },
    {
      heading: 'provenance',
      body: [
        'freshness: live (current record state)',
        record.projectId ? `project: ${record.projectId}` : 'project: (none)',
        `created: ${record.createdAt} by ${record.createdByUserId}`,
        `updated: ${record.updatedAt}`,
        record.lockedAt
          ? `locked: ${record.lockedAt} (revision ${record.lockedByRevisionId ?? 'unknown'})`
          : 'locked: no',
      ].join('\n'),
    },
    { heading: 'properties', body: propsBody },
  ]
  const pins: AiVersionPin[] =
    ref.pinnedVersionId != null
      ? [
          {
            kind: 'asserted' as const,
            id: ref.pinnedVersionId,
            detail: `requester-asserted pin on ${ref.kind} ${ref.id}; stated verbatim, not resolved to immutable state`,
          },
        ]
      : []
  return {
    ok: true,
    object: {
      kind: ref.kind,
      id: record.id,
      title: record.title,
      deepLink: recordDestination(record.kind, record.id),
      freshness: 'live',
      pins,
      sections,
      truncated: false,
    },
  }
}

async function resolveNotebook(
  client: DataClient,
  ref: AiObjectRef,
  workspaceId: string,
): Promise<ResolvedObject> {
  const record = await fetchRecord(client, ref.id)
  if (!record) return { ok: false, omission: notVisible(ref.kind, ref.id) }
  const wire = await client.list<{ workspace_id?: string }>(
    'records',
    `?id=eq.${encodeURIComponent(ref.id)}&select=workspace_id&limit=1`,
  )
  if (wire[0]?.workspace_id !== workspaceId) {
    return {
      ok: false,
      omission: {
        kind: ref.kind,
        id: ref.id,
        reason: 'wrong_workspace',
        detail: `object ${ref.kind}:${ref.id} is not in workspace ${workspaceId}; omitted without material`,
      },
    }
  }
  const [blocks, links] = await Promise.all([
    fetchBlocksForRecord(client, record.id),
    fetchLinksForRecord(client, record.id),
  ])
  const pins: AiVersionPin[] =
    ref.pinnedVersionId != null
      ? [
          {
            kind: 'asserted' as const,
            id: ref.pinnedVersionId,
            detail: `requester-asserted pin on notebook ${ref.id}; stated verbatim, not resolved to immutable state`,
          },
        ]
      : []
  const sections: Array<{ heading: string; body: string }> = [
    {
      heading: 'identity',
      body: [
        `identifier: ${record.identifier}`,
        `title: ${record.title}`,
        `kind: ${record.kind}`,
        `status: ${record.status}`,
        'freshness: live (current notebook state)',
        `blocks: ${blocks.length}`,
      ].join('\n'),
    },
  ]
  for (const block of blocks) {
    const summary = blockSummary(block)
    pins.push(...summary.pins)
    sections.push({ heading: `block:${block.type}`, body: summary.body })
  }
  sections.push({
    heading: 'provenance',
    body:
      links.length > 0
        ? [
            `links: ${links.length}`,
            ...links.map(
              (link) =>
                `- ${link.linkType} → ${link.targetKind} ${link.targetIdentifier}`,
            ),
          ].join('\n')
        : 'links: (none)',
  })
  return {
    ok: true,
    object: {
      kind: ref.kind,
      id: record.id,
      title: record.title,
      deepLink: recordDestination(record.kind, record.id),
      freshness: 'live',
      pins,
      sections,
      truncated: false,
    },
  }
}

async function resolveSheet(
  client: DataClient,
  ref: AiObjectRef,
  workspaceId: string,
): Promise<ResolvedObject> {
  const instance = await fetchSheetInstance(ref.id, client)
  if (instance) {
    if (instance.workspaceId !== workspaceId) {
      return {
        ok: false,
        omission: {
          kind: ref.kind,
          id: ref.id,
          reason: 'wrong_workspace',
          detail: `object ${ref.kind}:${ref.id} is not in workspace ${workspaceId}; omitted without material`,
        },
      }
    }
    const pins: AiVersionPin[] = []
    if (instance.sourceDefinitionVersionId) {
      pins.push({
        kind: 'sheet_definition_version',
        id: instance.sourceDefinitionVersionId,
        detail: `source definition version the instance was created from (revision ${instance.revision})`,
      })
    }
    if (ref.pinnedVersionId != null) {
      // The pin names a Sheet Definition Version. The RLS-filtered read is
      // the visibility check: an invisible version reads as absent.
      let version = null
      try {
        version = await fetchSheetDefinitionVersion(ref.pinnedVersionId, client)
      } catch {
        version = null
      }
      if (!version) {
        return { ok: false, omission: notVisible(ref.kind, ref.id) }
      }
      pins.push({
        kind: 'sheet_definition_version',
        id: version.id,
        detail: `pinned definition version ${version.version} (${version.lifecycle}) of definition ${version.definitionId}`,
      })
      return {
        ok: true,
        object: {
          kind: ref.kind,
          id: instance.id,
          title: instance.name,
          deepLink: sheetPath(instance.id),
          freshness: 'pinned',
          pins,
          sections: [
            {
              heading: 'identity',
              body: [
                `name: ${instance.name}`,
                `lifecycle: ${instance.lifecycle}`,
                `revision: ${instance.revision}`,
                'freshness: pinned (definition version stated above; instance state is live and not sampled)',
              ].join('\n'),
            },
          ],
          truncated: false,
        },
      }
    }
    return {
      ok: true,
      object: {
        kind: ref.kind,
        id: instance.id,
        title: instance.name,
        deepLink: sheetPath(instance.id),
        freshness: 'live',
        pins,
        sections: [
          {
            heading: 'identity',
            body: [
              `name: ${instance.name}`,
              `description: ${instance.description ?? '(none)'}`,
              `lifecycle: ${instance.lifecycle}`,
              `revision: ${instance.revision}`,
              'freshness: live (current instance state)',
              instance.notebookRecordId
                ? `notebook record: ${instance.notebookRecordId}`
                : 'notebook record: (none)',
            ].join('\n'),
          },
        ],
        truncated: false,
      },
    }
  }
  const definition = await fetchSheetDefinition(ref.id, client)
  if (!definition || definition.workspaceId !== workspaceId) {
    if (definition && definition.workspaceId !== workspaceId) {
      return {
        ok: false,
        omission: {
          kind: ref.kind,
          id: ref.id,
          reason: 'wrong_workspace',
          detail: `object ${ref.kind}:${ref.id} is not in workspace ${workspaceId}; omitted without material`,
        },
      }
    }
    return { ok: false, omission: notVisible(ref.kind, ref.id) }
  }
  let pinnedVersion = null
  if (ref.pinnedVersionId != null) {
    try {
      pinnedVersion = await fetchSheetDefinitionVersion(
        ref.pinnedVersionId,
        client,
      )
    } catch {
      pinnedVersion = null
    }
    if (!pinnedVersion || pinnedVersion.definitionId !== definition.id) {
      return { ok: false, omission: notVisible(ref.kind, ref.id) }
    }
  }
  return resolveSheetDefinition(
    ref,
    definition.name,
    definition.key,
    definition.lifecycle,
    definition.revision,
    pinnedVersion,
  )
}

function resolveSheetDefinition(
  ref: AiObjectRef,
  name: string,
  key: string,
  lifecycle: string,
  revision: number,
  pinnedVersion: { id: string; version: number; lifecycle: string } | null,
): ResolvedObject {
  const pins: AiVersionPin[] = pinnedVersion
    ? [
        {
          kind: 'sheet_definition_version' as const,
          id: pinnedVersion.id,
          detail: `pinned definition version ${pinnedVersion.version} (${pinnedVersion.lifecycle})`,
        },
      ]
    : []
  return {
    ok: true,
    object: {
      kind: ref.kind,
      id: ref.id,
      title: name,
      deepLink: sheetPath(ref.id),
      freshness: pinnedVersion ? 'pinned' : 'live',
      pins,
      sections: [
        {
          heading: 'identity',
          body: [
            `name: ${name}`,
            `key: ${key}`,
            `lifecycle: ${lifecycle}`,
            `revision: ${revision}`,
            pinnedVersion
              ? 'freshness: pinned (definition version stated above)'
              : 'freshness: live (current definition state)',
          ].join('\n'),
        },
      ],
      truncated: false,
    },
  }
}

async function resolveDataset(
  client: DataClient,
  ref: AiObjectRef,
  workspaceId: string,
  budgets: AiContextBudgets,
): Promise<ResolvedObject> {
  const summaries = await fetchDatasetSummaries(client, {
    includeArchived: true,
  })
  const table = summaries.find((entry) => entry.id === ref.id)
  // The summaries list is RLS-filtered: absence means not found or not
  // visible to the requesting actor.
  if (!table) return { ok: false, omission: notVisible(ref.kind, ref.id) }
  if (table.workspace_id !== workspaceId) {
    return {
      ok: false,
      omission: {
        kind: ref.kind,
        id: ref.id,
        reason: 'wrong_workspace',
        detail: `object ${ref.kind}:${ref.id} is not in workspace ${workspaceId}; omitted without material`,
      },
    }
  }
  const pinned = ref.pinnedVersionId != null
  const pins: AiVersionPin[] = pinned
    ? [
        {
          kind: 'dataset_version' as const,
          id: ref.pinnedVersionId as string,
          detail: `requester-asserted dataset version pin on dataset ${table.id} (revision ${table.revision ?? 'unknown'}); stated verbatim — live rows withheld so pinned and live state are never mixed`,
        },
      ]
    : []
  const columns = table.columns
  const datasetName = table.name || table.resource_name || table.id
  const sections: Array<{ heading: string; body: string }> = [
    {
      heading: 'identity',
      body: [
        `name: ${datasetName}`,
        table.description ? `description: ${table.description}` : null,
        `lifecycle: ${table.lifecycle}`,
        `revision: ${table.revision ?? 'unknown'}`,
        table.schema_version_number != null
          ? `schema version: ${table.schema_version_number}`
          : null,
        pinned
          ? 'freshness: pinned (version stated above; live rows withheld)'
          : 'freshness: live (current dataset state)',
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
    },
    {
      heading: 'schema',
      body:
        columns.length > 0
          ? columns
              .map(
                (column) =>
                  `- ${column.label} (${column.logical_type}${column.nullable ? ', nullable' : ''})`,
              )
              .join('\n')
          : '(no fields)',
    },
  ]
  let rowsSampled = 0
  if (
    !pinned &&
    ref.includeSampleRows === true &&
    budgets.maxRowsPerDataset > 0
  ) {
    const page = await fetchDatasetRowPage(client, table, {
      pageIndex: 0,
      pageSize: budgets.maxRowsPerDataset,
      sorting: [],
      filters: [],
    })
    rowsSampled = page.rows.length
    const lines = page.rows.map((row) => {
      const {
        id: _id,
        version: _version,
        ...values
      } = row as Record<string, unknown>
      return `- row ${(row as { id?: unknown }).id ?? '?'}: ${scalarSummary(redact(values))}`
    })
    sections.push({
      heading: 'sample_rows',
      body: [
        `sample: first ${page.rows.length} of ${page.totalCount} rows (live)`,
        ...lines,
      ].join('\n'),
    })
  }
  return {
    ok: true,
    object: {
      kind: ref.kind,
      id: table.id,
      title: datasetName,
      deepLink: datasetPath(table.id),
      freshness: pinned ? 'pinned' : 'live',
      pins,
      sections,
      truncated: false,
    },
    rowsSampled,
  }
}

async function resolveAnalysis(
  client: DataClient,
  ref: AiObjectRef,
  workspaceId: string,
): Promise<ResolvedObject> {
  const wire = await fetchAnalysisDefinition(client, ref.id)
  if (!wire) return { ok: false, omission: notVisible(ref.kind, ref.id) }
  if (wire.workspace_id !== workspaceId) {
    return {
      ok: false,
      omission: {
        kind: ref.kind,
        id: ref.id,
        reason: 'wrong_workspace',
        detail: `object ${ref.kind}:${ref.id} is not in workspace ${workspaceId}; omitted without material`,
      },
    }
  }
  const pins: AiVersionPin[] =
    ref.pinnedVersionId != null
      ? [
          {
            kind: 'asserted' as const,
            id: ref.pinnedVersionId,
            detail: `requester-asserted pin on analysis ${ref.id}; stated verbatim, not resolved to immutable state`,
          },
        ]
      : []
  const sources = Array.isArray(wire.source_revisions)
    ? wire.source_revisions
    : []
  return {
    ok: true,
    object: {
      kind: ref.kind,
      // Saved analysis definitions have no product deep-link surface;
      // AI-02 will cite the source datasets/versions instead.
      deepLink: null,
      id: wire.id,
      title: wire.name,
      freshness: 'live',
      pins,
      sections: [
        {
          heading: 'identity',
          body: [
            `name: ${wire.name}`,
            `definition version: ${wire.version}`,
            'freshness: live (saved definition; reruns against current rows unless source revisions pin otherwise)',
            `updated: ${wire.updated_at}`,
          ].join('\n'),
        },
        {
          heading: 'sources',
          body:
            sources.length > 0
              ? sources
                  .map(
                    (source) =>
                      `- dataset ${source.datasetId}: schema version ${source.schemaVersionNumber}, revision ${source.revision}`,
                  )
                  .join('\n')
              : '(no dataset sources recorded)',
        },
      ],
      truncated: false,
    },
  }
}

// ---------------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------------

/**
 * Assemble the permitted context envelope for the requesting actor.
 *
 * Every read goes through the actor's `DataClient` (RLS-filtered) and the
 * canonical resolvers above. Anything invisible, foreign-workspace, or over
 * budget is an explicit entry in `omissions` — never silent, never leaked.
 * The returned envelope is transient: it is not persisted anywhere.
 */
export async function assembleAiContext(
  client: DataClient,
  actor: AiContextActor | null | undefined,
  input: AssembleAiContextInput | null | undefined,
): Promise<AiContextEnvelope> {
  if (!actor || typeof actor.id !== 'string' || actor.id === '') {
    throw new Error('assembleAiContext: actor with a non-empty id is required')
  }
  if (
    !input ||
    typeof input.workspaceId !== 'string' ||
    input.workspaceId === ''
  ) {
    throw new Error('assembleAiContext: workspaceId is required (fail closed)')
  }
  const budgets = resolveBudgets(input.budgets)
  const refs = Array.isArray(input.objectRefs) ? input.objectRefs : []

  let project: { id: string; title: string } | null = null
  const omissions: AiContextOmission[] = []
  if (input.projectId != null) {
    // fetchProject is the canonical RLS-filtered resolver: a null return
    // means the project is absent or invisible to the requesting actor.
    const resolved = await fetchProject(client, input.projectId)
    if (!resolved) {
      omissions.push({
        kind: 'project',
        id: input.projectId,
        reason: 'not_visible',
        detail: `project ${input.projectId} not found or not visible to the requesting actor; omitted without material`,
      })
    } else {
      project = { id: resolved.id, title: resolved.title }
    }
  }

  const objects: AiContextObject[] = []
  const usage: AiContextBudgetUsage = {
    chars: 0,
    sections: 0,
    rows: 0,
    objects: 0,
  }

  const head = refs.slice(0, budgets.maxObjects)
  const dropped = refs.slice(budgets.maxObjects)
  for (const ref of dropped) {
    omissions.push({
      kind: String((ref as AiObjectRef | null)?.kind ?? 'unknown'),
      id: String((ref as AiObjectRef | null)?.id ?? 'unknown'),
      reason: 'budget_exceeded',
      detail: `object ${(ref as AiObjectRef | null)?.kind ?? 'unknown'}:${(ref as AiObjectRef | null)?.id ?? 'unknown'} dropped: maxObjects=${budgets.maxObjects} exceeded`,
    })
  }

  for (const ref of head) {
    if (
      !ref ||
      !AI_OBJECT_REF_KINDS.includes(ref.kind) ||
      typeof ref.id !== 'string' ||
      ref.id === ''
    ) {
      omissions.push({
        kind: String((ref as AiObjectRef | null)?.kind ?? 'unknown'),
        id: String((ref as AiObjectRef | null)?.id ?? 'unknown'),
        reason: 'unsupported_kind',
        detail: `unsupported object ref kind '${String((ref as AiObjectRef | null)?.kind)}'; supported kinds: ${AI_OBJECT_REF_KINDS.join(', ')}`,
      })
      continue
    }
    let resolved: ResolvedObject
    switch (ref.kind) {
      case 'record':
        resolved = await resolveRecord(client, ref, input.workspaceId)
        break
      case 'notebook':
        resolved = await resolveNotebook(client, ref, input.workspaceId)
        break
      case 'sheet':
        resolved = await resolveSheet(client, ref, input.workspaceId)
        break
      case 'dataset':
        resolved = await resolveDataset(client, ref, input.workspaceId, budgets)
        break
      case 'analysis':
        resolved = await resolveAnalysis(client, ref, input.workspaceId)
        break
    }
    if (!resolved.ok) {
      omissions.push(resolved.omission)
      continue
    }
    // Per-section budget with explicit truncation markers.
    const truncatedSections = resolved.object.sections.map((section) =>
      truncateSection(
        section.heading,
        section.body,
        budgets.maxCharsPerSection,
      ),
    )
    // Per-object section budget: drop whole trailing sections, name the cut.
    let finalSections = truncatedSections
    let truncated = false
    if (finalSections.length > budgets.maxSectionsPerObject) {
      const kept = finalSections.slice(0, budgets.maxSectionsPerObject)
      const cut = finalSections.slice(budgets.maxSectionsPerObject)
      truncated = true
      finalSections = [
        ...kept,
        {
          heading: 'truncation',
          body: `[omitted: ${cut.length} further sections exceeded maxSectionsPerObject=${budgets.maxSectionsPerObject}: ${cut.map((s) => s.heading).join(', ')}]`,
          truncated: true,
        },
      ]
    }
    const candidate: AiContextObject = {
      ...resolved.object,
      sections: finalSections,
      truncated,
    }
    // Total budget is enforced at object granularity: an object that does
    // not fit becomes an explicit omission naming the ref and the budget.
    const size = candidate.sections.reduce((sum, s) => sum + s.body.length, 0)
    if (usage.chars + size > budgets.maxCharsTotal) {
      omissions.push({
        kind: ref.kind,
        id: ref.id,
        reason: 'budget_exceeded',
        detail: `object ${ref.kind}:${ref.id} (${size} chars) dropped: maxCharsTotal=${budgets.maxCharsTotal} with ${usage.chars} chars already assembled`,
      })
      continue
    }
    objects.push(candidate)
    usage.chars += size
    usage.sections += candidate.sections.length
    usage.rows += resolved.rowsSampled ?? 0
    usage.objects += 1
  }

  return {
    version: AI_CONTEXT_VERSION,
    actor: { kind: actor.kind, id: actor.id },
    workspace: { id: input.workspaceId, project },
    objects,
    omissions,
    budgets: { applied: budgets, usage },
  }
}
