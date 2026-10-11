/**
 * R5-NOTE-01 — the annotated-document read model.
 *
 * The review workspace already computes exactly one deterministic comparison
 * (`diffRevisionEnvelopes`, REV-003). This module turns that same result into a
 * reading model for the frozen revision under review: the document's own
 * order, which of its parts changed, the scalar before/after pairs that read
 * as an inline insertion or deletion, and where each anchored comment belongs.
 *
 * Two rules hold throughout:
 *
 * 1. The document is the immutable `canonical_snapshot` of the revision being
 *    reviewed — never the live record and never a live re-read. Anything the
 *    snapshot does not carry is stated as unavailable instead of fetched.
 * 2. An anchor is never moved. A comment whose target is not part of the
 *    revision and comparison actually being read keeps its recorded anchor and
 *    is reported as no longer applying; it is not re-pointed at whatever
 *    similar change happens to exist now.
 */
import { diffRevisionEnvelopes } from './revision-diff'
import type {
  CanonicalRevisionEntity,
  CanonicalRevisionEnvelope,
  RevisionChange,
  RevisionChangeKind,
  RevisionDiffResult,
} from './revision-diff'
import type { CommentWire } from './comments-data'
import type { FrozenSheetEvidence } from './sheet-evidence'

// ---------------------------------------------------------------------------
// Document model.
// ---------------------------------------------------------------------------

/** Areas of the frozen revision that are not notebook blocks. */
export type DocumentAreaKey = 'metadata' | 'links' | 'formulas' | 'files'

export interface DocumentAreaSection {
  key: DocumentAreaKey
  label: string
  changes: RevisionChange[]
}

export type DocumentBlockPresence = 'added' | 'removed' | 'retained'

export interface DocumentBlockEntry {
  id: string
  type: string
  label: string
  order: number
  presence: DocumentBlockPresence
  /**
   * The block as it reads in the frozen revision. For a removal there is no
   * successor block, so this is the predecessor: the document still shows what
   * was removed.
   */
  block: CanonicalRevisionEntity
  /** The predecessor block when it differs from `block`. */
  before?: CanonicalRevisionEntity
  /** Frozen Sheet evidence attached to this block, when the revision carries it. */
  evidence?: FrozenSheetEvidence
  /** Scalar before/after pairs read as inline <del>/<ins> marks. */
  inline: RevisionChange[]
  /** Every change attributed to this block, for its change cards. */
  changes: RevisionChange[]
}

export interface DocumentTableEntry {
  tableId: string
  label: string
  changes: RevisionChange[]
}

export interface RevisionDocument {
  /** The frozen revision the document renders. */
  revision: CanonicalRevisionEnvelope
  /** The revision the marks were computed against, when one is available. */
  comparison: CanonicalRevisionEnvelope | null
  diff: RevisionDiffResult
  blocks: DocumentBlockEntry[]
  tables: DocumentTableEntry[]
  areas: DocumentAreaSection[]
  /**
   * Changes the document cannot place inside a block, table or area section.
   * Kept so a change is never silently dropped from the reading view.
   */
  unattributed: RevisionChange[]
  counts: Record<RevisionChangeKind, number>
  changedBlockCount: number
  unchanged: boolean
}

const AREA_SECTION_LABELS: Record<DocumentAreaKey, string> = {
  metadata: 'Record metadata',
  links: 'Linked records',
  formulas: 'Formulas',
  files: 'Files',
}

const AREA_SECTION_ORDER: DocumentAreaKey[] = [
  'metadata',
  'links',
  'formulas',
  'files',
]

const BLOCK_TYPE_LABELS: Record<string, string> = {
  rich_text: 'Text',
  heading: 'Heading',
  note: 'Note',
  callout: 'Callout',
  checklist: 'Checklist',
  metric: 'Metric',
  table: 'Table',
  sheet: 'Sheet',
  chart: 'Chart',
  analysis: 'Analysis',
  pipeline_output: 'Pipeline output',
  plate_map: 'Plate map',
  file: 'File',
  linked_record: 'Linked record',
  protocol_reference: 'Protocol reference',
  materials: 'Materials',
  procedure_step: 'Procedure step',
}

function isEntity(value: unknown): value is CanonicalRevisionEntity {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

/** The first readable line of a frozen block payload, without any live read. */
export function blockLabel(block: CanonicalRevisionEntity): string {
  const payload: Record<string, unknown> = isEntity(block.payload)
    ? block.payload
    : {}
  const own =
    asString(payload.title) ??
    asString(payload.text) ??
    asString(payload.label) ??
    asString(payload.displayName) ??
    asString(payload.protocolTitle)
  if (own) return own.length > 80 ? `${own.slice(0, 79)}…` : own
  const type = asString(block.type) ?? 'block'
  return BLOCK_TYPE_LABELS[type] ?? `Block ${String(block.id)}`
}

/** The entity identity of a notebook block inside the canonical envelope. */
function blockId(value: unknown): string | null {
  return isEntity(value) ? asString(value.id) : null
}

/** A scalar change reads as an inline insertion or deletion; an object does not. */
function isScalarChange(change: RevisionChange): boolean {
  if (change.kind === 'moved') return false
  const scalar = (value: unknown) =>
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  if (change.before !== undefined && !scalar(change.before)) return false
  if (change.after !== undefined && !scalar(change.after)) return false
  return true
}

/**
 * A change reads inline in the prose when it is the text of the block (area
 * `text`, path `doc`) or a scalar leaf of the block's own payload (a checklist
 * item's text). Structural block changes and cell changes are cards, not
 * prose.
 */
function isInlineTextChange(change: RevisionChange): boolean {
  if (!isScalarChange(change)) return false
  if (change.area === 'text') return true
  if (change.area === 'checklists' && change.path.at(-1) === 'text') return true
  return false
}

/** Which block a change belongs to, using the identities the diff engine emits. */
function changeBlockId(change: RevisionChange): string | null {
  if (change.area === 'tables') return change.tableId ?? null
  if (change.area === 'formulas') {
    // Sheet formula identities are `${blockId}:${calculationId}`.
    const separator = change.identity.indexOf(':')
    return separator > 0 ? change.identity.slice(0, separator) : null
  }
  if (change.area === 'files') return null
  const separator = change.identity.indexOf(':')
  return separator > 0 ? change.identity.slice(0, separator) : change.identity
}

function sheetEvidenceByBlock(
  revision: CanonicalRevisionEnvelope,
): Map<string, FrozenSheetEvidence> {
  const map = new Map<string, FrozenSheetEvidence>()
  for (const evidence of revision.sheetEvidence ?? []) {
    map.set(evidence.blockId, evidence)
  }
  return map
}

/**
 * Build the reading model for the frozen revision `after`, marked against
 * `before`. `before === null` (a first submission) renders the document with no
 * marks rather than inventing a comparison.
 */
export function buildRevisionDocument(
  before: CanonicalRevisionEnvelope | null,
  after: CanonicalRevisionEnvelope,
): RevisionDocument {
  const comparison = before
  const diff = diffRevisionEnvelopes(before ?? after, after)
  const evidenceByBlock = sheetEvidenceByBlock(after)
  const beforeBlocks = new Map<string, CanonicalRevisionEntity>()
  for (const block of before?.blocks ?? []) {
    const id = blockId(block)
    if (id) beforeBlocks.set(id, block)
  }

  const blocks: DocumentBlockEntry[] = []
  const attributed = new Set<string>()
  const blockIds = new Set<string>()
  for (const block of after.blocks) {
    const id = blockId(block)
    if (id) blockIds.add(id)
  }
  for (const block of before?.blocks ?? []) {
    const id = blockId(block)
    if (id && !blockIds.has(id)) blockIds.add(id)
  }

  const ordered = [...blockIds].sort((left, right) => {
    const leftBlock =
      after.blocks.find((block) => blockId(block) === left) ??
      beforeBlocks.get(left)
    const rightBlock =
      after.blocks.find((block) => blockId(block) === right) ??
      beforeBlocks.get(right)
    if (!leftBlock || !rightBlock) return left.localeCompare(right)
    const leftOrder = typeof leftBlock.order === 'number' ? leftBlock.order : 0
    const rightOrder =
      typeof rightBlock.order === 'number' ? rightBlock.order : 0
    return leftOrder - rightOrder || left.localeCompare(right)
  })

  for (const id of ordered) {
    const successor = after.blocks.find((block) => blockId(block) === id)
    const predecessor = beforeBlocks.get(id)
    const block = successor ?? predecessor
    if (!block) continue
    const changes = diff.changes.filter(
      (change) => changeBlockId(change) === id,
    )
    for (const change of changes) attributed.add(change.id)
    const inline = changes.filter(isInlineTextChange)
    const presence: DocumentBlockPresence = !predecessor
      ? 'added'
      : !successor
        ? 'removed'
        : 'retained'
    blocks.push({
      id,
      type: asString(block.type) ?? 'unknown',
      label: blockLabel(block),
      order: typeof block.order === 'number' ? block.order : blocks.length,
      presence,
      block,
      ...(predecessor && predecessor !== block ? { before: predecessor } : {}),
      ...(evidenceByBlock.has(id) ? { evidence: evidenceByBlock.get(id) } : {}),
      inline,
      changes,
    })
  }

  const tables: DocumentTableEntry[] = []
  for (const summary of diff.tableSummaries) {
    tables.push({
      tableId: summary.tableId,
      label: summary.label,
      changes: summary.changes,
    })
  }

  const areas: DocumentAreaSection[] = AREA_SECTION_ORDER.map((key) => ({
    key,
    label: AREA_SECTION_LABELS[key],
    changes: diff.changes.filter(
      (change) => change.area === key && !attributed.has(change.id),
    ),
  })).filter((section) => section.changes.length > 0)

  const placed = new Set(attributed)
  for (const table of tables) {
    for (const change of table.changes) placed.add(change.id)
  }
  for (const area of areas) {
    for (const change of area.changes) placed.add(change.id)
  }
  const unattributed = diff.changes.filter((change) => !placed.has(change.id))

  return {
    revision: after,
    comparison,
    diff,
    blocks,
    tables,
    areas,
    unattributed,
    counts: diff.counts,
    changedBlockCount: blocks.filter((block) => block.changes.length > 0)
      .length,
    unchanged: diff.unchanged,
  }
}

// ---------------------------------------------------------------------------
// Comment anchors.
// ---------------------------------------------------------------------------

export type DocumentLocation =
  | { kind: 'revision' }
  | { kind: 'block'; blockId: string }
  | { kind: 'table'; tableId: string }
  | { kind: 'sheet'; blockId: string; instanceId: string }
  | { kind: 'change'; changeId: string }

export type CommentOrphanReason =
  /** The thread is anchored to a different revision (an earlier round). */
  | 'anchored-to-another-revision'
  /** The thread was written against a different comparison revision. */
  | 'comparison-changed'
  /** The change it named is not part of the comparison being read. */
  | 'change-not-in-comparison'
  /** The block it named is not in this revision. */
  | 'block-not-in-revision'
  /** The table it named is not in this revision. */
  | 'table-not-in-revision'
  /** The frozen Sheet instance it named is not in this revision. */
  | 'sheet-not-in-revision'

export interface DocumentCommentAnchor {
  comment: CommentWire
  replies: CommentWire[]
  resolved: boolean
  /** Where the comment reads in the document; absent when it is an orphan. */
  location?: DocumentLocation
  /** Why the comment no longer applies to the document being read. */
  orphanReason?: CommentOrphanReason
  /** The revision the thread is anchored to (its own immutable revision id). */
  anchoredRevisionId: string | null
}

export interface PlaceDocumentCommentsInput {
  document: RevisionDocument
  /** Every comment fetched for the revision (roots and replies). */
  comments: readonly CommentWire[]
  /** The revision being read; a thread anchored elsewhere is never re-anchored. */
  revisionId: string | null
  /** The comparison revision the marks were computed against. */
  comparisonRevisionId: string | null
}

/**
 * Resolve every comment thread to a document location, or to the honest reason
 * it no longer applies. Resolution uses only identities present in the frozen
 * revision and the comparison it is marked against; nothing is matched by
 * similarity.
 */
export function placeDocumentComments({
  document,
  comments,
  revisionId,
  comparisonRevisionId,
}: PlaceDocumentCommentsInput): DocumentCommentAnchor[] {
  const roots = comments.filter((comment) => comment.parent_id === null)
  const repliesByRoot = new Map<string, CommentWire[]>()
  for (const comment of comments) {
    if (comment.parent_id === null) continue
    const list = repliesByRoot.get(comment.root_id) ?? []
    list.push(comment)
    repliesByRoot.set(comment.root_id, list)
  }

  const blockIds = new Set(document.blocks.map((block) => block.id))
  const tableIdsInRevision = new Set(
    document.revision.scientificTables.map((table) => String(table.id)),
  )
  const evidenceByInstance = new Map<string, string>()
  for (const evidence of document.revision.sheetEvidence ?? []) {
    evidenceByInstance.set(evidence.instanceId, evidence.blockId)
  }
  const changeIds = new Set(document.diff.changes.map((change) => change.id))

  const anchors: DocumentCommentAnchor[] = []
  for (const comment of roots) {
    const replies = (repliesByRoot.get(comment.root_id) ?? []).sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    )
    const anchor: DocumentCommentAnchor = {
      comment,
      replies,
      resolved: comment.state === 'resolved',
      anchoredRevisionId: comment.revision_id,
    }
    const target = comment.target
    let location: DocumentLocation | undefined
    let orphanReason: CommentOrphanReason | undefined

    if (revisionId !== null && comment.revision_id !== revisionId) {
      orphanReason = 'anchored-to-another-revision'
    } else if (comment.target_kind === 'revision') {
      location = { kind: 'revision' }
    } else if (comment.target_kind === 'block') {
      const id = asString(target.blockId)
      if (id && blockIds.has(id)) location = { kind: 'block', blockId: id }
      else orphanReason = 'block-not-in-revision'
    } else if (comment.target_kind === 'table_region') {
      const id = asString(target.tableId)
      if (id && tableIdsInRevision.has(id))
        location = { kind: 'table', tableId: id }
      else orphanReason = 'table-not-in-revision'
    } else if (
      comment.target_kind === 'sheet_cell' ||
      comment.target_kind === 'sheet_row' ||
      comment.target_kind === 'sheet_range'
    ) {
      const instanceId = asString(target.instanceId)
      const blockIdForSheet = instanceId
        ? evidenceByInstance.get(instanceId)
        : undefined
      if (instanceId && blockIdForSheet) {
        location = { kind: 'sheet', blockId: blockIdForSheet, instanceId }
      } else {
        orphanReason = 'sheet-not-in-revision'
      }
    } else {
      // A diff thread names both the comparison it was written against and the
      // deterministic change id. Both must still hold.
      const comparison = asString(target.comparisonRevisionId)
      const changeId = asString(target.changeId)
      if (comparison === null || comparison !== comparisonRevisionId) {
        orphanReason = 'comparison-changed'
      } else if (!changeId || !changeIds.has(changeId)) {
        orphanReason = 'change-not-in-comparison'
      } else {
        location = { kind: 'change', changeId }
      }
    }

    if (location) anchor.location = location
    if (orphanReason) anchor.orphanReason = orphanReason
    anchors.push(anchor)
  }

  return anchors
}

/** True when the anchor reads inside the document rather than in the orphans. */
export function isPlaced(
  anchor: DocumentCommentAnchor,
): anchor is DocumentCommentAnchor & { location: DocumentLocation } {
  return anchor.location !== undefined
}

export const ORPHAN_REASON_TEXT: Record<CommentOrphanReason, string> = {
  'anchored-to-another-revision':
    'Anchored to an earlier revision of this record. A later revision replaced what it referred to, so it is not re-anchored here.',
  'comparison-changed':
    'Written against a different comparison revision. The change it referred to is not the one being read, so it is not re-anchored here.',
  'change-not-in-comparison':
    'The change it referred to is not part of this comparison.',
  'block-not-in-revision':
    'The block it referred to is not present in this revision.',
  'table-not-in-revision':
    'The table it referred to is not present in this revision.',
  'sheet-not-in-revision':
    'The frozen Sheet it referred to is not carried by this revision.',
}
