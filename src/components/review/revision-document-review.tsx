/**
 * R5-NOTE-01 — the annotated document reading surface.
 *
 * A reviewer reads the frozen submitted revision as the document it is: the
 * notebook's own blocks in order, change marks (Δ) in the gutter, inline
 * insertions and deletions, change cards inside the block they belong to, and
 * the anchored comments beside the text they are about.
 *
 * Everything rendered here comes from two immutable inputs: the revision's
 * frozen `canonical_snapshot` and the REV-003 diff against the selected
 * comparison revision. Nothing re-reads the live record, the live Sheet or the
 * live protocol: block types whose preview would fetch live content render the
 * frozen facts the snapshot carries instead and say so.
 *
 * The change list (`RevisionDiffReview`) stays available alongside this view;
 * neither replaces the other.
 */
import * as React from 'react'

import { BlockPreview } from '#/components/notebook/block-preview'
import { FrozenSheetEvidencePanel } from '#/components/notebook/notebook-sheet-block'
import { Button } from '#/components/v3/ui/button'
import { Icon } from '#/components/v3/icons'
import type {
  CommentTarget,
  CommentTargetKind,
  CommentWire,
} from '#/lib/comments-data'
import type { NotebookBlock } from '#/lib/notebook-data'
import type {
  CanonicalRevisionEntity,
  CanonicalRevisionEnvelope,
  RevisionChange,
} from '#/lib/revision-diff'
import {
  ORPHAN_REASON_TEXT,
  buildRevisionDocument,
  isPlaced,
  placeDocumentComments,
} from '#/lib/revision-document'
import type {
  DocumentBlockEntry,
  DocumentCommentAnchor,
  DocumentLocation,
  RevisionDocument,
} from '#/lib/revision-document'
import type { SheetCommentAnchor } from '#/lib/sheet-comment-anchor'
import { cn } from '#/lib/utils'

import { KindBadge, ChangeCard, focusChange } from './revision-diff-review'

/** A comment target a reviewer can create from the document itself. */
export interface DocumentAnchorTarget {
  targetKind: CommentTargetKind
  target: CommentTarget
}

export interface RevisionDocumentReviewProps {
  /** The frozen revision that is rendered — never a live document. */
  after: CanonicalRevisionEnvelope
  /** The revision the marks are computed against; null for a first submission. */
  before?: CanonicalRevisionEnvelope | null
  /** Revision id of `after`; a comment anchored elsewhere is never re-anchored. */
  revisionId?: string | null
  /** The comparison revision the marks were computed against. */
  comparisonRevisionId?: string | null
  beforeLabel?: string
  afterLabel?: string
  /** Every comment fetched for the revision (roots and replies). */
  comments?: readonly CommentWire[]
  /** A comment to reveal when the route deep-links to it. */
  focusCommentId?: string
  /** Comment → comments panel: open this thread beside the document. */
  onOpenComment?: (commentId: string) => void
  /** Start a comment anchored to a block or a change. */
  onCommentTarget?: (target: DocumentAnchorTarget) => void
  /** Start a comment on a frozen Sheet selection (the grid supplies the anchor). */
  onSheetCommentTarget?: (anchor: SheetCommentAnchor) => void
  /** Human label for a revision id (for comments anchored to earlier rounds). */
  revisionLabels?: ReadonlyMap<string, string>
  className?: string
}

/**
 * Block types whose preview resolves content at read time. A frozen revision
 * must not trigger those reads, so the document renders the frozen payload
 * facts for them instead.
 */
const LIVE_PREVIEW_BLOCK_TYPES = new Set([
  'sheet',
  'file',
  'protocol_reference',
  'pipeline_output',
  'analysis',
])

function isEntity(value: unknown): value is CanonicalRevisionEntity {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function fieldValue(value: unknown): string | null {
  const asText = text(value)
  if (asText) return asText
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return null
}

/** Adapt a frozen canonical block to the notebook's read-only preview shape. */
function toPreviewBlock(
  block: CanonicalRevisionEntity,
  recordId: string,
): NotebookBlock {
  const payload = isEntity(block.payload) ? block.payload : {}
  return {
    id: String(block.id),
    recordId,
    type: typeof block.type === 'string' ? block.type : 'unknown',
    payload,
    payloadSchemaVersion:
      typeof block.payloadSchemaVersion === 'number'
        ? block.payloadSchemaVersion
        : 0,
    order: typeof block.order === 'number' ? block.order : 0,
    version: typeof block.version === 'number' ? block.version : 0,
  }
}

function locationId(location: DocumentLocation): string {
  switch (location.kind) {
    case 'revision':
      return 'revision'
    case 'block':
      return location.blockId
    case 'sheet':
      return location.blockId
    case 'table':
      return location.tableId
    case 'change':
      return location.changeId
  }
}

function findMarked(root: HTMLElement | null, value: string) {
  if (!root) return undefined
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-doc-location]'),
  ).find((element) => element.dataset.docLocation === value)
}

function findComment(root: HTMLElement | null, commentId: string) {
  if (!root) return undefined
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-comment-id]'),
  ).find((element) => element.dataset.commentId === commentId)
}

// ---------------------------------------------------------------------------
// Change marks.
// ---------------------------------------------------------------------------

function ChangeGutter({
  entry,
  onSelect,
}: {
  entry: DocumentBlockEntry
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-doc-gutter={entry.id}
      onClick={onSelect}
      aria-label={`${entry.changes.length} ${
        entry.changes.length === 1 ? 'change' : 'changes'
      } in ${entry.label}`}
      className="absolute left-0 top-0 inline-flex size-7 items-center justify-center rounded-sm border border-review bg-review-wash text-xs font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring md:-left-[30px]"
    >
      Δ
    </button>
  )
}

/** Scalar before/after read as an insertion or a deletion in the prose. */
function InlineMark({ change }: { change: RevisionChange }) {
  return (
    <p className="mt-1.5 max-w-[680px] text-sm leading-6 text-fg-muted">
      <span className="mr-1.5 text-xs uppercase tracking-wide">Text</span>
      {change.before === undefined ? null : (
        <del className="text-danger-text" aria-label="Removed text">
          {String(change.before)}
        </del>
      )}
      {change.before !== undefined && change.after !== undefined ? ' ' : null}
      {change.after === undefined ? null : (
        <ins
          className="text-success-text no-underline"
          aria-label="Inserted text"
        >
          {String(change.after)}
        </ins>
      )}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Frozen block content.
// ---------------------------------------------------------------------------

function FrozenFacts({ block }: { block: CanonicalRevisionEntity }) {
  const payload: Record<string, unknown> = isEntity(block.payload)
    ? block.payload
    : {}
  const facts = [
    ['Name', fieldValue(payload.displayName) ?? fieldValue(payload.label)],
    ['Media type', fieldValue(payload.mediaType)],
    ['Size', fieldValue(payload.byteSize)],
    ['Protocol', fieldValue(payload.protocolTitle)],
    ['Protocol id', fieldValue(payload.protocolIdentifier)],
    ['Approval', fieldValue(payload.approvalStatus)],
    ['Analysis', fieldValue(payload.title)],
    ['Run', fieldValue(payload.runId)],
    ['Dataset version', fieldValue(payload.datasetVersionId)],
  ].filter((entry): entry is [string, string] => entry[1] !== null)
  return (
    <div className="rounded-md border border-dashed bg-surface-muted px-3 py-2.5">
      <p className="text-xs font-semibold text-fg">
        {text(block.type) ?? 'Block'} — frozen at submission
      </p>
      {facts.length > 0 ? (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {facts.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-fg-muted">{label}</dt>
              <dd className="m-0 break-words">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
      <p className="mt-1.5 text-xs text-fg-muted">
        A frozen revision never loads live content. Open the record for the
        current state of this block.
      </p>
    </div>
  )
}

function FrozenBlockContent({
  entry,
  recordId,
  onSheetCommentTarget,
}: {
  entry: DocumentBlockEntry
  recordId: string
  onSheetCommentTarget?: (anchor: SheetCommentAnchor) => void
}) {
  if (entry.type === 'sheet') {
    return entry.evidence ? (
      <FrozenSheetEvidencePanel
        evidence={entry.evidence}
        onCommentTarget={onSheetCommentTarget}
      />
    ) : (
      <p
        role="status"
        className="rounded-md border border-dashed bg-surface-muted p-3 text-xs text-fg-muted"
      >
        This revision carries no frozen Sheet evidence for this block. The
        submitted values cannot be shown, and the live Sheet is not read here.
      </p>
    )
  }
  const frozenAnalysis =
    entry.type === 'analysis' &&
    isEntity(entry.block.payload) &&
    isEntity(entry.block.payload.frozen)
  if (LIVE_PREVIEW_BLOCK_TYPES.has(entry.type) && !frozenAnalysis) {
    return <FrozenFacts block={entry.block} />
  }
  return <BlockPreview block={toPreviewBlock(entry.block, recordId)} frozen />
}

// ---------------------------------------------------------------------------
// Comments.
// ---------------------------------------------------------------------------

function CommentCard({
  anchor,
  revisionLabels,
  highlighted,
  note,
  onShowLocation,
  onOpenComment,
}: {
  anchor: DocumentCommentAnchor
  revisionLabels?: ReadonlyMap<string, string>
  highlighted: boolean
  /** Why the comment reads outside a marked part of the document. */
  note?: string
  onShowLocation?: (location: DocumentLocation) => void
  onOpenComment?: (commentId: string) => void
}) {
  const { comment, location, orphanReason } = anchor
  const anchoredLabel = comment.revision_id
    ? (revisionLabels?.get(comment.revision_id) ??
      `revision ${comment.revision_id.slice(0, 8)}`)
    : null
  return (
    <aside
      data-comment-id={comment.id}
      id={`doc-comment-${comment.id}`}
      tabIndex={-1}
      aria-label={
        orphanReason
          ? `Comment that no longer applies, ${comment.body.slice(0, 60)}`
          : `Comment, ${comment.body.slice(0, 60)}`
      }
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-md border border-warning/40 bg-surface px-3 py-2.5 text-sm shadow-overlay outline-none',
        highlighted && 'ring-2 ring-primary/40',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {anchor.resolved ? (
          <span className="text-xs font-medium text-fg-muted">Resolved</span>
        ) : (
          <span className="text-xs font-medium text-fg">Open</span>
        )}
        {anchor.replies.length > 0 ? (
          <span className="text-xs text-fg-muted">
            {anchor.replies.length}{' '}
            {anchor.replies.length === 1 ? 'reply' : 'replies'}
          </span>
        ) : null}
        {anchoredLabel ? (
          <span className="text-xs text-fg-muted">{anchoredLabel}</span>
        ) : null}
      </div>
      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6">
        {comment.body}
      </p>
      {orphanReason ? (
        <p className="m-0 text-xs text-fg-muted">
          {ORPHAN_REASON_TEXT[orphanReason]}
        </p>
      ) : null}
      {note ? <p className="m-0 text-xs text-fg-muted">{note}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {location && onShowLocation ? (
          <Button
            variant="quiet"
            size="sm"
            aria-label={`Show the place this comment is about, ${comment.id}`}
            onClick={() => onShowLocation(location)}
          >
            Show location
          </Button>
        ) : null}
        {onOpenComment ? (
          <Button
            variant="quiet"
            size="sm"
            aria-label={`Open thread in the comments panel, ${comment.id}`}
            onClick={() => onOpenComment(comment.id)}
          >
            Open in Comments
          </Button>
        ) : null}
      </div>
    </aside>
  )
}

function CommentMarker({
  anchors,
  label,
  onShowComment,
}: {
  anchors: DocumentCommentAnchor[]
  label: string
  onShowComment: (commentId: string) => void
}) {
  if (anchors.length === 0) return null
  return (
    <Button
      variant="quiet"
      size="sm"
      aria-label={`Show ${anchors.length} ${
        anchors.length === 1 ? 'comment' : 'comments'
      } on ${label}`}
      onClick={() => onShowComment(anchors[0].comment.id)}
    >
      <Icon name="comment" size={12} aria-hidden="true" />
      {anchors.length}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Document.
// ---------------------------------------------------------------------------

function ChangeCards({
  changes,
  activeChangeId,
  onActiveChange,
  onCommentTarget,
  comparisonRevisionId,
  renderChangeAnchors,
}: {
  changes: RevisionChange[]
  activeChangeId: string | null
  onActiveChange: (changeId: string) => void
  onCommentTarget?: (target: DocumentAnchorTarget) => void
  comparisonRevisionId: string | null
  /** Anchored comments read beside the change they were written against. */
  renderChangeAnchors?: (changeId: string) => React.ReactNode
}) {
  return (
    <div className="mt-2 space-y-2">
      {changes.map((change) => (
        <div
          key={change.id}
          data-doc-location={change.id}
          tabIndex={-1}
          className="outline-none"
          onFocus={() => onActiveChange(change.id)}
        >
          <ChangeCard change={change} active={change.id === activeChangeId} />
          {onCommentTarget ? (
            <Button
              variant="quiet"
              size="sm"
              className="mt-1"
              aria-label={`Comment on change ${change.label}`}
              onClick={() =>
                onCommentTarget({
                  targetKind: 'diff',
                  target: {
                    changeId: change.id,
                    area: change.area,
                    identity: change.identity,
                    comparisonRevisionId: comparisonRevisionId ?? undefined,
                  },
                })
              }
            >
              <Icon name="comment" size={12} aria-hidden="true" />
              Comment on this change
            </Button>
          ) : null}
          {renderChangeAnchors ? renderChangeAnchors(change.id) : null}
        </div>
      ))}
    </div>
  )
}

export function RevisionDocumentReview({
  after,
  before = null,
  revisionId = null,
  comparisonRevisionId = null,
  beforeLabel = 'Earlier revision',
  afterLabel = 'Submitted revision',
  comments = [],
  focusCommentId,
  onOpenComment,
  onCommentTarget,
  onSheetCommentTarget,
  revisionLabels,
  className,
}: RevisionDocumentReviewProps) {
  const rootRef = React.useRef<HTMLElement>(null)
  const [showMarks, setShowMarks] = React.useState(true)
  const [activeChangeId, setActiveChangeId] = React.useState<string | null>(
    null,
  )
  const [highlightedLocation, setHighlightedLocation] = React.useState<
    string | null
  >(null)
  const [highlightedComment, setHighlightedComment] = React.useState<
    string | null
  >(null)

  const document: RevisionDocument = React.useMemo(
    () => buildRevisionDocument(before, after),
    [after, before],
  )
  const anchors = React.useMemo(
    () =>
      placeDocumentComments({
        document,
        comments,
        revisionId,
        comparisonRevisionId,
      }),
    [comments, comparisonRevisionId, document, revisionId],
  )
  const placed = anchors.filter(isPlaced)
  const orphans = anchors.filter((anchor) => anchor.orphanReason !== undefined)

  const anchorsFor = React.useCallback(
    (value: string) =>
      placed.filter((anchor) => locationId(anchor.location) === value),
    [placed],
  )
  /**
   * A comment can be anchored to a part of the frozen revision that carries no
   * change (an unchanged scientific table, for example). It is still placed —
   * its anchor holds — but the marked document has no section for it, so those
   * threads are listed rather than dropped.
   */
  const unmarked = React.useMemo(() => {
    const rendered = new Set<string>(['revision'])
    for (const block of document.blocks) rendered.add(block.id)
    for (const table of document.tables) rendered.add(table.tableId)
    for (const area of document.areas) rendered.add(`area-${area.key}`)
    for (const change of document.diff.changes) rendered.add(change.id)
    return placed.filter((anchor) => !rendered.has(locationId(anchor.location)))
  }, [document, placed])
  const orphanRegionRef = React.useRef<HTMLElement>(null)

  const showLocation = React.useCallback((location: DocumentLocation) => {
    const id = locationId(location)
    setHighlightedLocation(id)
    setHighlightedComment(null)
    // The element is already mounted: focus it so the move is announced.
    focusChange(findMarked(rootRef.current, id))
  }, [])

  const showComment = React.useCallback((commentId: string) => {
    setHighlightedComment(commentId)
    setHighlightedLocation(null)
    const element = findComment(rootRef.current, commentId)
    if (element) focusChange(element)
  }, [])

  React.useEffect(() => {
    if (!focusCommentId) return
    if (!anchors.some((anchor) => anchor.comment.id === focusCommentId)) return
    showComment(focusCommentId)
  }, [anchors, focusCommentId, showComment])

  const recordId = String(document.revision.record.id ?? '')
  const totalChanges = document.diff.changes.length

  function renderAnchors(value: string, label: string) {
    const forLocation = anchorsFor(value)
    if (forLocation.length === 0) return null
    return (
      <div
        role="group"
        aria-label={label}
        className="mt-3 flex min-w-0 flex-col gap-2 lg:max-w-[360px]"
      >
        {forLocation.map((anchor) => (
          <CommentCard
            key={anchor.comment.id}
            anchor={anchor}
            revisionLabels={revisionLabels}
            highlighted={highlightedComment === anchor.comment.id}
            onShowLocation={showLocation}
            onOpenComment={onOpenComment}
          />
        ))}
      </div>
    )
  }

  function renderChangeAnchors(changeId: string) {
    return renderAnchors(changeId, 'Comments on this change')
  }

  function renderBlock(entry: DocumentBlockEntry) {
    const changed = entry.changes.length > 0
    const marked = showMarks && changed
    const content = (
      <FrozenBlockContent
        entry={entry}
        recordId={recordId}
        onSheetCommentTarget={onSheetCommentTarget}
      />
    )
    return (
      <section
        key={entry.id}
        id={`doc-block-${entry.id}`}
        data-doc-location={entry.id}
        data-doc-block={entry.id}
        tabIndex={-1}
        aria-label={`${entry.label}${marked ? ' (changed)' : ''}`}
        className={cn(
          'relative flex min-w-0 flex-col rounded-lg border border-transparent px-6 py-4 outline-none md:px-10',
          marked && 'border-border bg-surface/60',
          highlightedLocation === entry.id && 'ring-2 ring-primary/40',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {marked ? (
              <ChangeGutter
                entry={entry}
                onSelect={() => {
                  const first = entry.changes[0]
                  setActiveChangeId(first.id)
                  focusChange(findMarked(rootRef.current, first.id))
                }}
              />
            ) : null}
            <span className="truncate text-xs uppercase tracking-wide text-fg-muted">
              {entry.label}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {marked ? (
              <KindBadge
                kind={
                  entry.presence === 'added'
                    ? 'added'
                    : entry.presence === 'removed'
                      ? 'removed'
                      : entry.changes.every((change) => change.kind === 'moved')
                        ? 'moved'
                        : 'modified'
                }
              />
            ) : null}
            {showMarks ? (
              <CommentMarker
                anchors={anchorsFor(entry.id)}
                label={entry.label}
                onShowComment={showComment}
              />
            ) : null}
            {onCommentTarget ? (
              <Button
                variant="quiet"
                size="sm"
                aria-label={`Comment on ${entry.label}`}
                onClick={() =>
                  onCommentTarget({
                    targetKind: 'block',
                    target: { blockId: entry.id },
                  })
                }
              >
                <Icon name="comment" size={12} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-2 flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:gap-6">
          <div className="min-w-0 flex-1">
            {entry.presence === 'added' && marked ? (
              <ins className="block no-underline">{content}</ins>
            ) : entry.presence === 'removed' ? (
              <del className="block">{content}</del>
            ) : (
              content
            )}
            {marked
              ? entry.inline.map((change) => (
                  <InlineMark key={change.id} change={change} />
                ))
              : null}
            {marked ? (
              <ChangeCards
                changes={entry.changes}
                activeChangeId={activeChangeId}
                onActiveChange={setActiveChangeId}
                onCommentTarget={onCommentTarget}
                comparisonRevisionId={comparisonRevisionId}
                renderChangeAnchors={renderChangeAnchors}
              />
            ) : null}
            {!marked && changed ? (
              <p className="mt-1 text-xs text-fg-muted">
                {entry.changes.length}{' '}
                {entry.changes.length === 1 ? 'change' : 'changes'} hidden —
                turn marks on to read them.
              </p>
            ) : null}
          </div>
          {renderAnchors(entry.id, `Comments on ${entry.label}`)}
        </div>
      </section>
    )
  }

  return (
    <section
      ref={rootRef}
      aria-label="Submitted revision document"
      className={cn('min-w-0 space-y-4', className)}
    >
      <header
        id="revision-document-header"
        data-doc-location="revision"
        tabIndex={-1}
        className={cn(
          'flex flex-col gap-3 rounded-lg border bg-surface p-3 outline-none',
          highlightedLocation === 'revision' && 'ring-2 ring-primary/40',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Annotated document
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
              <span>{afterLabel}</span>
              {document.comparison ? (
                <>
                  <span aria-hidden="true" className="text-fg-muted">
                    against
                  </span>
                  <span>{beforeLabel}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg-muted" aria-live="polite">
              {totalChanges} {totalChanges === 1 ? 'change' : 'changes'} ·{' '}
              {document.changedBlockCount}{' '}
              {document.changedBlockCount === 1 ? 'block' : 'blocks'} marked
            </span>
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={showMarks}
              aria-label={showMarks ? 'Hide change marks' : 'Show change marks'}
              onClick={() => setShowMarks((current) => !current)}
            >
              {showMarks ? 'Hide marks' : 'Show marks'}
            </Button>
          </div>
        </div>
        <p className="text-xs text-fg-muted">
          Read from the frozen revision submitted for review. The live record is
          not read here; comments keep the anchor they were written with.
        </p>
        {onCommentTarget ? (
          <div>
            <Button
              variant="quiet"
              size="sm"
              aria-label="Comment on the whole revision"
              onClick={() =>
                onCommentTarget({ targetKind: 'revision', target: {} })
              }
            >
              <Icon name="comment" size={12} aria-hidden="true" />
              Comment on the whole revision
            </Button>
          </div>
        ) : null}
        {renderAnchors('revision', 'Comments on the whole revision')}
      </header>

      {document.unchanged ? (
        <div
          role="status"
          className="rounded-lg border border-dashed bg-surface-muted p-4 text-sm"
        >
          <p className="font-semibold">
            No meaningful changes in this comparison
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            The submitted scientific content reads the same as the comparison
            revision. The document is shown unmarked.
          </p>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-3">
        {document.blocks.map(renderBlock)}
      </div>

      {document.tables.map((table) => (
        <section
          key={table.tableId}
          id={`doc-table-${table.tableId}`}
          data-doc-location={table.tableId}
          tabIndex={-1}
          aria-label={`Scientific table ${table.label}`}
          className={cn(
            'relative min-w-0 rounded-lg border border-border bg-surface/60 px-6 py-4 outline-none md:px-10',
            highlightedLocation === table.tableId && 'ring-2 ring-primary/40',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-fg-muted">
              Scientific table · {table.label}
            </span>
            <div className="flex items-center gap-2">
              <KindBadge kind="modified" />
              {showMarks ? (
                <CommentMarker
                  anchors={anchorsFor(table.tableId)}
                  label={table.label}
                  onShowComment={showComment}
                />
              ) : null}
            </div>
          </div>
          {showMarks ? (
            <ChangeCards
              changes={table.changes}
              activeChangeId={activeChangeId}
              onActiveChange={setActiveChangeId}
              onCommentTarget={onCommentTarget}
              comparisonRevisionId={comparisonRevisionId}
              renderChangeAnchors={renderChangeAnchors}
            />
          ) : (
            <p className="mt-2 text-xs text-fg-muted">
              {table.changes.length}{' '}
              {table.changes.length === 1 ? 'change' : 'changes'} hidden — turn
              marks on to read them.
            </p>
          )}
          {renderAnchors(table.tableId, `Comments on ${table.label}`)}
        </section>
      ))}

      {document.areas.map((area) => (
        <section
          key={area.key}
          id={`doc-area-${area.key}`}
          data-doc-location={`area-${area.key}`}
          tabIndex={-1}
          aria-label={area.label}
          className="min-w-0 rounded-lg border border-border bg-surface/60 px-6 py-4 outline-none md:px-10"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-fg-muted">
              {area.label}
            </span>
            <KindBadge kind="modified" />
          </div>
          {showMarks ? (
            <ChangeCards
              changes={area.changes}
              activeChangeId={activeChangeId}
              onActiveChange={setActiveChangeId}
              onCommentTarget={onCommentTarget}
              comparisonRevisionId={comparisonRevisionId}
              renderChangeAnchors={renderChangeAnchors}
            />
          ) : (
            <p className="mt-2 text-xs text-fg-muted">
              {area.changes.length}{' '}
              {area.changes.length === 1 ? 'change' : 'changes'} hidden — turn
              marks on to read them.
            </p>
          )}
          {renderAnchors(`area-${area.key}`, `Comments on ${area.label}`)}
        </section>
      ))}

      {document.unattributed.length > 0 ? (
        <section
          aria-label="Unplaced changes"
          className="min-w-0 rounded-lg border border-dashed px-6 py-4 md:px-10"
        >
          <p className="text-xs uppercase tracking-wide text-fg-muted">
            Other changes
          </p>
          <ChangeCards
            changes={document.unattributed}
            activeChangeId={activeChangeId}
            onActiveChange={setActiveChangeId}
            onCommentTarget={onCommentTarget}
            comparisonRevisionId={comparisonRevisionId}
            renderChangeAnchors={renderChangeAnchors}
          />
        </section>
      ) : null}

      {unmarked.length > 0 ? (
        <section
          aria-label="Comments anchored to unmarked parts of this revision"
          className="min-w-0 rounded-lg border border-dashed px-4 py-3"
        >
          <h2 className="text-sm font-semibold">
            Comments anchored to unmarked parts of this revision
          </h2>
          <p className="mt-1 text-xs text-fg-muted">
            The anchor holds; the part it is about carries no change in this
            comparison, so the marked document has no place to show it.
          </p>
          <div className="mt-3 flex min-w-0 flex-col gap-2">
            {unmarked.map((anchor) => (
              <CommentCard
                key={anchor.comment.id}
                anchor={anchor}
                revisionLabels={revisionLabels}
                highlighted={highlightedComment === anchor.comment.id}
                onShowLocation={showLocation}
                onOpenComment={onOpenComment}
              />
            ))}
          </div>
        </section>
      ) : null}

      {orphans.length > 0 ? (
        <section
          ref={orphanRegionRef}
          tabIndex={-1}
          aria-label="Comments that no longer apply to this revision"
          className="min-w-0 rounded-lg border border-dashed bg-surface-muted px-4 py-3 outline-none"
        >
          <h2 className="text-sm font-semibold">
            Comments that no longer apply to this revision
          </h2>
          <p className="mt-1 text-xs text-fg-muted">
            Each thread keeps the anchor it was written with. Nothing here is
            moved onto a similar change.
          </p>
          <div className="mt-3 flex min-w-0 flex-col gap-2">
            {orphans.map((anchor) => (
              <CommentCard
                key={anchor.comment.id}
                anchor={anchor}
                revisionLabels={revisionLabels}
                highlighted={highlightedComment === anchor.comment.id}
                onOpenComment={onOpenComment}
              />
            ))}
          </div>
        </section>
      ) : null}
    </section>
  )
}
