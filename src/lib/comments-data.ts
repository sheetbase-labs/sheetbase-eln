/**
 * REV-004 data layer for anchored review comments. Comments live on the
 * same PostgREST boundary as the rest of the notebook domain: a REST
 * collection (`api.comments`, read-only for request roles) plus four
 * SECURITY DEFINER RPCs for create/reply/resolve/reopen. The wire shape
 * mirrors the database columns; the UI groups rows into threads by
 * `rootId` and renders unavailable targets and departed users honestly.
 */
import type { DataClient } from './data-client'
import { sheetCommentAnchorSchema } from './sheet-comment-anchor'
import type { SheetCommentAnchor } from './sheet-comment-anchor'

/** Stable anchor target descriptor within an immutable revision. */
export type CommentTargetKind =
  | 'revision'
  | 'block'
  | 'table_region'
  | 'diff'
  | SheetCommentAnchor['targetKind']

export interface CommentTarget {
  /** Present for block / table_region / diff targets. */
  blockId?: string
  tableId?: string
  rowId?: string
  columnId?: string
  instanceId?: string
  rowKeys?: string[]
  fieldIds?: string[]
  /** Present for diff targets: the other immutable revision in the comparison. */
  comparisonRevisionId?: string
  /** Deterministic diff change id (from src/lib/revision-diff.ts). */
  changeId?: string
  area?: string
  identity?: string
  [key: string]: unknown
}

/** Wire shape of a comment row, as delivered by PostgREST. */
export interface CommentWire {
  id: string
  workspace_id: string
  revision_id: string | null
  record_id: string | null
  sheet_instance_id: string | null
  root_id: string
  parent_id: string | null
  target_kind: CommentTargetKind
  target: CommentTarget
  body: string
  mentions: string[]
  state: 'open' | 'resolved'
  resolved_at: string | null
  resolved_by_user_id: string | null
  author_user_id: string | null
  created_at: string
  updated_at: string
}

export interface CreateCommentInput {
  revisionId: string
  targetKind: CommentTargetKind
  target: CommentTarget
  body: string
  mentions?: string[]
}

export interface CommentMutationResult {
  id: string
  revisionId: string | null
  sheetInstanceId?: string | null
  rootId: string
  parentId: string | null
  targetKind: CommentTargetKind
  target: CommentTarget
  body: string
  mentions: string[]
  state: 'open' | 'resolved'
  authorUserId: string | null
  createdAt: string
}

export interface ResolveThreadResult {
  id: string
  state: 'open' | 'resolved'
  resolvedByUserId: string | null
  resolvedAt: string | null
}

/** Query keys for the comments collection, scoped by revision id. */
export const commentsQueryKeys = {
  forRevision: (revisionId: string) =>
    ['comments', 'revision', revisionId] as const,
  forRecord: (recordId: string) => ['comments', 'record', recordId] as const,
  forSheet: (instanceId: string) => ['comments', 'sheet', instanceId] as const,
}

/** Fetch every comment anchored to a revision, ordered oldest-first. */
export function fetchCommentsForRevision(
  client: DataClient,
  revisionId: string,
): Promise<CommentWire[]> {
  return client
    .list<CommentWire>(
      'comments',
      `?revision_id=eq.${revisionId}&order=created_at.asc`,
    )
    .then((rows) => rows.map(normaliseComment))
}

export function fetchCommentsForSheet(
  client: DataClient,
  instanceId: string,
): Promise<CommentWire[]> {
  return client
    .list<CommentWire>(
      'comments',
      `?sheet_instance_id=eq.${instanceId}&revision_id=is.null&order=created_at.asc`,
    )
    .then((rows) => rows.map(normaliseComment))
}

/** The server derives visible embeddings and rechecks both Instance and Record ACLs. */
export function fetchCommentsForRecord(
  client: DataClient,
  recordId: string,
): Promise<CommentWire[]> {
  return client
    .rpc<CommentWire[]>('record_comments', { p_record_id: recordId })
    .then((rows) => rows.map(normaliseComment))
}

export function createSheetComment(
  client: DataClient,
  input: {
    anchor: SheetCommentAnchor
    expectedRevision: number
    body: string
    mentions?: string[]
  },
): Promise<CommentMutationResult> {
  const anchor = sheetCommentAnchorSchema.parse(input.anchor)
  return client.rpc('create_sheet_comment', {
    p_instance_id: anchor.target.instanceId,
    p_expected_instance_revision: input.expectedRevision,
    p_target_kind: anchor.targetKind,
    p_target: anchor.target,
    p_body: input.body,
    p_mentions: input.mentions ?? [],
  })
}

/** Create a new top-level comment anchored to an immutable revision. */
export function createComment(
  client: DataClient,
  input: CreateCommentInput,
): Promise<CommentMutationResult> {
  return client.rpc('create_comment', {
    p_revision_id: input.revisionId,
    p_target_kind: input.targetKind,
    p_target: input.target,
    p_body: input.body,
    p_mentions: input.mentions ?? [],
  })
}

/** Reply to an existing comment, inheriting its thread root and anchor. */
export function replyToComment(
  client: DataClient,
  parentId: string,
  body: string,
  mentions?: string[],
): Promise<CommentMutationResult> {
  return client.rpc('reply_to_comment', {
    p_parent_id: parentId,
    p_body: body,
    p_mentions: mentions ?? [],
  })
}

/** Resolve a comment thread (any comment id in the thread resolves the root). */
export function resolveCommentThread(
  client: DataClient,
  commentId: string,
): Promise<ResolveThreadResult> {
  return client.rpc('resolve_comment_thread', { p_comment_id: commentId })
}

/** Reopen a resolved comment thread. */
export function reopenCommentThread(
  client: DataClient,
  commentId: string,
): Promise<ResolveThreadResult> {
  return client.rpc('reopen_comment_thread', { p_comment_id: commentId })
}

// ---------------------------------------------------------------------------
// Threading helpers.
// ---------------------------------------------------------------------------

/** A top-level comment plus its ordered replies. */
export interface CommentThread {
  root: CommentWire
  replies: CommentWire[]
}

/**
 * Group flat comment rows into threads ordered oldest-first. Replies are
 * ordered by created_at within a thread. Roots are ordered by created_at.
 */
export function groupCommentsIntoThreads(rows: CommentWire[]): CommentThread[] {
  const roots: CommentWire[] = []
  const repliesByRoot = new Map<string, CommentWire[]>()

  for (const row of rows) {
    if (row.parent_id === null) {
      roots.push(row)
    } else {
      const rootId = row.root_id
      const list = repliesByRoot.get(rootId) ?? []
      list.push(row)
      repliesByRoot.set(rootId, list)
    }
  }

  roots.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return roots.map((root) => ({
    root: normaliseComment(root),
    replies: (repliesByRoot.get(root.id) ?? [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((reply) => normaliseComment(reply)),
  }))
}

/** Thread state is the root's state; replies inherit it for display. */
export function threadState(thread: CommentThread): 'open' | 'resolved' {
  return thread.root.state
}

function normaliseComment(row: CommentWire): CommentWire {
  return {
    ...row,
    target: typeof row.target === 'object' ? row.target : {},
  }
}
