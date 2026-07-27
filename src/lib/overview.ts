/**
 * Experiment overview composition library (SCI-007, decision 0032).
 *
 * The overview is a read-only composed view of a notebook's blocks and linked
 * records. This module provides the pure functions that map blocks to overview
 * sections, validate overview configuration, and detect locked/historical
 * states. It contains no data fetching — the route and data helpers own queries.
 *
 * Section mapping is derived from block type (decision 0032 §2): a block's
 * type determines its section, and blocks appear in notebook order within each
 * section. Unknown block types fall into an "Other" section as readable
 * placeholders, preserving decision 0015's forward-compatibility guarantee.
 */

import type {
  NotebookBlock,
  NotebookRecord,
  RevisionWire,
} from './notebook-data'

// ---------------------------------------------------------------------------
// Section definitions.
// ---------------------------------------------------------------------------

/** Canonical overview section identifiers, in display order. */
export const SECTION_ORDER = [
  'notes',
  'materials',
  'procedures',
  'tables',
  'visualizations',
  'metrics',
  'files',
  'links',
  'tasks',
  'other',
] as const

export type SectionId = (typeof SECTION_ORDER)[number]

/** Human-readable label for each section. */
export const SECTION_LABELS: Record<SectionId, string> = {
  notes: 'Notes',
  materials: 'Materials',
  procedures: 'Procedures',
  tables: 'Tables & data',
  visualizations: 'Visualizations',
  metrics: 'Metrics',
  files: 'Files',
  links: 'Linked records',
  tasks: 'Tasks',
  other: 'Other',
}

/**
 * Maps a block type to its overview section. Derived from the block model
 * (decision 0015) and the overview mockup — not user-configured.
 */
export const BLOCK_SECTION_MAP: Record<string, SectionId> = {
  rich_text: 'notes',
  callout: 'notes',
  materials: 'materials',
  protocol_reference: 'procedures',
  procedure_step: 'procedures',
  table: 'tables',
  sheet: 'tables',
  chart: 'visualizations',
  plate_map: 'visualizations',
  metric: 'metrics',
  file: 'files',
  linked_record: 'links',
  checklist: 'tasks',
}

export function sectionForBlockType(type: string): SectionId {
  return BLOCK_SECTION_MAP[type] ?? 'other'
}

// ---------------------------------------------------------------------------
// Section composition.
// ---------------------------------------------------------------------------

/** A block annotated with its overview section, in notebook order. */
export interface SectionedBlock {
  block: NotebookBlock
  section: SectionId
}

/**
 * Assign each block to its overview section. Blocks are returned in the
 * original notebook order; callers group by section for display.
 */
export function assignSections(blocks: NotebookBlock[]): SectionedBlock[] {
  return blocks.map((block) => ({
    block,
    section: sectionForBlockType(block.type),
  }))
}

/** A fully composed overview section with its blocks in notebook order. */
export interface OverviewSection {
  id: SectionId
  label: string
  blocks: NotebookBlock[]
}

/**
 * Compose blocks into overview sections. Sections appear in canonical display
 * order (SECTION_ORDER); within each section, blocks appear in notebook order.
 * Empty sections (no blocks) are omitted unless `includeEmpty` is true.
 *
 * Blocks whose id appears in `excludedBlockIds` are filtered out before
 * section assignment, so excluded blocks never produce an empty section.
 */
export function composeSections(
  blocks: NotebookBlock[],
  excludedBlockIds: readonly string[] = [],
  includeEmpty = false,
): OverviewSection[] {
  const excluded = new Set(excludedBlockIds)
  const visible = blocks.filter((b) => !excluded.has(b.id))
  const sectioned = assignSections(visible)

  const sections: OverviewSection[] = []
  for (const sectionId of SECTION_ORDER) {
    const sectionBlocks = sectioned
      .filter((s) => s.section === sectionId)
      .map((s) => s.block)
    if (sectionBlocks.length > 0 || includeEmpty) {
      sections.push({
        id: sectionId,
        label: SECTION_LABELS[sectionId],
        blocks: sectionBlocks,
      })
    }
  }
  return sections
}

// ---------------------------------------------------------------------------
// Overview configuration (persisted in records.properties.overview).
// ---------------------------------------------------------------------------

/** Shape stored in `records.properties.overview`. */
export interface OverviewConfig {
  /** Block ids excluded from the overview. */
  excludedBlockIds: string[]
}

/** Extract the overview config from a record's properties. */
export function getOverviewConfig(
  properties: Record<string, unknown>,
): OverviewConfig {
  const overview = properties.overview
  if (
    typeof overview === 'object' &&
    overview !== null &&
    !Array.isArray(overview)
  ) {
    const raw = (overview as Record<string, unknown>).excludedBlockIds
    if (Array.isArray(raw) && raw.every((id) => typeof id === 'string')) {
      return { excludedBlockIds: raw }
    }
  }
  return { excludedBlockIds: [] }
}

/**
 * Validate and normalise an overview config update. Unknown block ids (ids not
 * in the record's blocks) are silently dropped — stale exclusions from deleted
 * blocks must not block the update or pollute the persisted array.
 */
export function normaliseOverviewConfig(
  excludedBlockIds: unknown,
  knownBlockIds: readonly string[],
): OverviewConfig {
  if (!Array.isArray(excludedBlockIds)) {
    return { excludedBlockIds: [] }
  }
  const known = new Set(knownBlockIds)
  const valid = excludedBlockIds.filter(
    (id): id is string => typeof id === 'string' && known.has(id),
  )
  return { excludedBlockIds: Array.from(new Set(valid)) }
}

/**
 * Merge an overview config into a record's existing properties, preserving all
 * other property keys. Returns a new properties object suitable for PATCH.
 */
export function mergeOverviewConfig(
  properties: Record<string, unknown>,
  config: OverviewConfig,
): Record<string, unknown> {
  return {
    ...properties,
    overview: { excludedBlockIds: config.excludedBlockIds },
  }
}

/**
 * Toggle a block's exclusion. Returns a new config with the block id added
 * (exclude) or removed (include). Does not mutate the input.
 */
export function toggleBlockExclusion(
  config: OverviewConfig,
  blockId: string,
  exclude: boolean,
): OverviewConfig {
  const set = new Set(config.excludedBlockIds)
  if (exclude) {
    set.add(blockId)
  } else {
    set.delete(blockId)
  }
  return { excludedBlockIds: Array.from(set) }
}

/** Whether a block is currently excluded from the overview. */
export function isBlockExcluded(
  config: OverviewConfig,
  blockId: string,
): boolean {
  return config.excludedBlockIds.includes(blockId)
}

// ---------------------------------------------------------------------------
// Locked / historical state detection.
// ---------------------------------------------------------------------------

/** The render mode the overview should use. */
export type OverviewMode = 'active' | 'locked' | 'archived' | 'historical'

/**
 * Determine the overview render mode from the record state and whether a
 * revision is being viewed.
 *
 * - `historical` — a revision snapshot is being viewed (takes precedence).
 * - `archived` — `record.archivedAt` is set.
 * - `locked` — the record is locked (`lockedAt` set by an approve-for-record
 *   signature, or `status` is `'locked'`).
 * - `active` — the live notebook is editable (overview itself is always
 *   read-only, but block-visibility toggles are available).
 */
export function detectOverviewMode(
  record: Pick<NotebookRecord, 'status' | 'archivedAt' | 'lockedAt'>,
  viewingRevision: boolean,
): OverviewMode {
  if (viewingRevision) return 'historical'
  if (record.archivedAt !== null) return 'archived'
  if (record.lockedAt !== null || record.status === 'locked') return 'locked'
  return 'active'
}

/** Whether the overview should show block-visibility toggles. */
export function canConfigureOverview(mode: OverviewMode): boolean {
  return mode === 'active'
}

/** Human-readable label for the overview mode badge. */
export const MODE_LABELS: Record<OverviewMode, string> = {
  active: 'Overview',
  locked: 'Locked',
  archived: 'Archived',
  historical: 'Historical',
}

// ---------------------------------------------------------------------------
// Revision snapshot parsing.
// ---------------------------------------------------------------------------

/** Domain shape of a revision for the overview. */
export interface OverviewRevision {
  id: string
  recordId: string
  reason: string
  createdAt: string
  createdByUserId: string
  superseded: boolean
  blocks: NotebookBlock[]
  metadata: Record<string, unknown>
}

/**
 * Parse a revision wire row into the domain shape, mapping the block snapshot
 * into `NotebookBlock[]` for the overview composer.
 */
export function toOverviewRevision(row: RevisionWire): OverviewRevision {
  return {
    id: row.id,
    recordId: row.record_id,
    reason: row.reason,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    superseded: row.superseded_by_revision_id !== null,
    blocks: row.block_snapshot.map((b) => ({
      id: b.id,
      recordId: row.record_id,
      type: b.type,
      payload: b.payload,
      payloadSchemaVersion: b.payload_schema_version,
      order: b.order,
      version: b.version,
    })),
    metadata: row.metadata_snapshot,
  }
}
