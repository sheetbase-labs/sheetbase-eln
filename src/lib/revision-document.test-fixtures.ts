/**
 * R5-NOTE-01 fixtures: one frozen revision, the revision it is marked against,
 * and comment wires for the anchors the annotated document has to resolve.
 */
import type { CommentWire } from './comments-data'
import type {
  CanonicalRevisionEntity,
  CanonicalRevisionEnvelope,
} from './revision-diff'

export const DOCUMENT_REVISION_ID = 'rev-after'
export const EARLIER_REVISION_ID = 'rev-before'

export function richTextBlock(
  id: string,
  order: number,
  paragraph: string,
): CanonicalRevisionEntity {
  return {
    id,
    type: 'rich_text',
    order,
    version: 1,
    payloadSchemaVersion: 1,
    payload: {
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: paragraph }] },
        ],
      },
    },
  }
}

function envelope(
  blocks: CanonicalRevisionEntity[],
  extra: Partial<CanonicalRevisionEnvelope> = {},
): CanonicalRevisionEnvelope {
  return {
    formatVersion: 1,
    record: {
      id: 'record-1',
      identifier: 'EXP-2026-001',
      title: 'Virus stability at 4 °C',
      status: 'draft',
      metadataVersion: 1,
    },
    blocks,
    links: [],
    scientificTables: [structuredClone(UNCHANGED_TABLE)],
    formulas: [],
    files: [],
    ...extra,
  }
}

export interface DocumentFixtures {
  before: CanonicalRevisionEnvelope
  after: CanonicalRevisionEnvelope
}

/**
 * One scientific table, identical in both revisions: it carries no change, so
 * the marked document has no section for it. A comment anchored to it must
 * still be shown rather than dropped.
 */
const UNCHANGED_TABLE: CanonicalRevisionEntity = {
  id: 'table-1',
  name: 'Transfection results',
  columns: [{ id: 'col-1', field_name: 'titre', label: 'Genome titre' }],
  rows: [{ id: 'row-1', titre: '1.2e10' }],
}

/**
 * `after` inserts one block, removes one block, changes one block's text and
 * leaves one block and the record metadata untouched.
 */
export function documentFixtures(): DocumentFixtures {
  const before = envelope([
    richTextBlock('block-objective', 0, 'Measure virus stability at 4 °C.'),
    richTextBlock(
      'block-method',
      1,
      'Cells were seeded at 2.0 × 10⁶ cells/mL.',
    ),
    {
      id: 'block-checklist',
      type: 'checklist',
      order: 2,
      version: 1,
      payloadSchemaVersion: 1,
      payload: {
        items: [{ id: 'item-1', text: 'Inspect plate', checked: false }],
      },
    },
    richTextBlock('block-removed', 3, 'Remove after review.'),
  ])
  const after = envelope([
    richTextBlock('block-objective', 0, 'Measure virus stability at 4 °C.'),
    richTextBlock(
      'block-method',
      1,
      'Cells were seeded at 2.0 × 10⁶ cells/mL and transfected at 1.0 µg DNA/mL.',
    ),
    {
      id: 'block-checklist',
      type: 'checklist',
      order: 2,
      version: 1,
      payloadSchemaVersion: 1,
      payload: {
        items: [{ id: 'item-1', text: 'Inspect plate', checked: false }],
      },
    },
    richTextBlock(
      'block-added',
      4,
      'Harvest at 72 h and measure genome titre.',
    ),
  ])
  return { before, after }
}

/** A comment wire with the fields the document view reads, plus overrides. */
export function commentFixture(
  overrides: Partial<CommentWire> & { id: string },
): CommentWire {
  return {
    workspace_id: 'workspace-1',
    revision_id: DOCUMENT_REVISION_ID,
    record_id: 'record-1',
    sheet_instance_id: null,
    root_id: overrides.id,
    parent_id: null,
    target_kind: 'revision',
    target: {},
    body: 'A review comment.',
    mentions: [],
    state: 'open',
    resolved_at: null,
    resolved_by_user_id: null,
    author_user_id: 'user-1',
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    ...overrides,
  }
}
