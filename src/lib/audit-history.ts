/**
 * GOV-03 — Audit & History data layer.
 *
 * Read model over the authoritative `api.change_events` stream, exposed to
 * the browser through the SECURITY DEFINER `api.audit_events` RPC. The RPC
 * enforces workspace membership (any role, including viewer), keeps
 * credential/invitation/settings/access event classes owner/admin/steward-
 * only, and paginates deterministically by the per-workspace gapless
 * sequence — so counts and rows of inaccessible objects can never leak.
 *
 * This module owns three pure concerns the UI composes:
 *  1. wire types + fetch for `api.audit_events`;
 *  2. semantic before/after rendering (`describeAuditEvent`) that turns
 *     trigger payloads into human phrases without fabricating values the
 *     event did not capture;
 *  3. explicit correlation grouping (`groupAuditEvents`) — events are only
 *     ever grouped through identity links recorded in payloads (credential
 *     rotation pairs), never through timestamp proximity.
 */

import { z } from 'zod'
import type { DataClient } from './data-client'
import type { TimelineEventWire } from './sign-002'
import { notebookDataClient } from './notebook-data'
import { datasetPath, recordPath, sheetPath } from './navigation'
import { csvEscape } from './export/delimited'
import { isRichTextPayload, richTextToPlainText } from './blocks/rich-text'

// ---------------------------------------------------------------------------
// Wire shapes (snake_case-free: the RPC returns jsonb keys we control).
// ---------------------------------------------------------------------------

export const auditEventsPageSchema = z
  .object({
    formatVersion: z.literal(1),
    events: z.array(
      z.object({
        sequence: z.number().int().positive(),
        id: z.string(),
        createdAt: z.iso.datetime(),
        entityType: z.string(),
        entityUuid: z.string(),
        operation: z.string(),
        recordId: z.string().nullable(),
        projectId: z.string().nullable(),
        actorUserId: z.string().nullable(),
        actorName: z.string().nullable(),
        actorCredentialId: z.string().nullable(),
        clientId: z.string().nullable(),
        payload: z.record(z.string(), z.unknown()),
      }),
    ),
    hasMore: z.boolean(),
    nextCursor: z.number().int().positive().nullable(),
  })
  .refine((page) => !page.hasMore || page.nextCursor !== null, {
    message: 'Audit continuation requires a sequence cursor.',
  })

export type AuditEventsPageWire = z.infer<typeof auditEventsPageSchema>
export type AuditEventWire = AuditEventsPageWire['events'][number]

export const auditHistoryCategories = [
  'all',
  'data',
  'text',
  'status',
  'files',
  'comments',
  'signatures',
] as const
export type AuditHistoryCategory = (typeof auditHistoryCategories)[number]

/** Classify captured event facts; an event can contain both text and status changes. */
export function auditEventMatchesCategory(
  event: AuditEventWire,
  category: AuditHistoryCategory,
): boolean {
  if (category === 'all') return true
  switch (category) {
    case 'files':
      return event.entityType === 'file'
    case 'comments':
      return event.entityType === 'comment'
    case 'signatures':
      return event.entityType === 'signature'
    case 'text':
      return (
        (event.entityType === 'block' && event.payload.type === 'rich_text') ||
        (event.entityType === 'record' && hasChange(event, 'title'))
      )
    case 'status':
      return (
        ['review_submission', 'review_decision', 'revision'].includes(
          event.entityType,
        ) ||
        (event.entityType === 'record' &&
          (event.operation === 'create' || hasChange(event, 'status')))
      )
    case 'data':
      return (
        [
          'dataset',
          'dataset_version',
          'sheet_instance',
          'scientific_row',
          'formula',
          'calculation',
          'sample_event',
        ].includes(event.entityType) ||
        (event.entityType === 'block' &&
          ['table', 'sheet', 'analysis'].includes(String(event.payload.type)))
      )
  }
}

export interface AuditEventsFilter {
  entityType?: string
  operation?: string
  actorUserId?: string
  from?: string
  to?: string
  search?: string
  /** Related object id: matches entity_uuid, record hint or payload ids. */
  object?: string
  /** Exclusive upper sequence cursor (descending pagination). */
  beforeSequence?: number
  limit?: number
}

// ---------------------------------------------------------------------------
// Query keys + fetch.
// ---------------------------------------------------------------------------

export const auditHistoryQueryKeys = {
  events: (filter: AuditEventsFilter) => ['audit-events', filter] as const,
}

export const auditHistoryDataClient: DataClient = notebookDataClient

/**
 * Fetch one deterministic page of audit events. The RPC denies non-members
 * and api credentials outright; callers surface the permission error.
 */
export async function fetchAuditEvents(
  client: DataClient,
  filter: AuditEventsFilter,
): Promise<AuditEventsPageWire> {
  return auditEventsPageSchema.parse(
    await client.rpc('audit_events', auditEventsRpcArgs(filter)),
  )
}

/** Load a stable prefix completely so category/actor counts and CSV share one selection. */
export async function fetchRecordAuditHistory(
  client: DataClient,
  recordId: string,
) {
  const events: AuditEventWire[] = []
  let beforeSequence: number | undefined
  let snapshotBefore = 1
  for (;;) {
    const page = await fetchAuditEvents(client, {
      object: recordId,
      beforeSequence,
      limit: 200,
    })
    if (beforeSequence === undefined)
      snapshotBefore = (page.events[0]?.sequence ?? 0) + 1
    events.push(...page.events)
    if (!page.hasMore) return { events, snapshotBefore }
    if (
      page.nextCursor === null ||
      (beforeSequence !== undefined && page.nextCursor >= beforeSequence)
    )
      throw new Error('Invalid audit continuation cursor.')
    beforeSequence = page.nextCursor
  }
}

/** Only explicit source-event identities establish scientific knock-on effects. */
export function auditKnockOnEvents(
  event: AuditEventWire,
  events: AuditEventWire[],
) {
  return events.filter(
    (candidate) =>
      candidate.id !== event.id && candidate.payload.sourceEventId === event.id,
  )
}

export function auditEventsRpcArgs(filter: AuditEventsFilter) {
  return {
    p_entity_type: filter.entityType ?? null,
    p_operation: filter.operation ?? null,
    p_actor_user_id: filter.actorUserId ?? null,
    p_from: filter.from ?? null,
    p_to: filter.to ?? null,
    p_search: filter.search?.trim() ? filter.search.trim() : null,
    p_object: filter.object ?? null,
    p_before_sequence: filter.beforeSequence ?? null,
    p_limit: filter.limit ?? 50,
  }
}

// ---------------------------------------------------------------------------
// Semantic rendering.
// ---------------------------------------------------------------------------

/** One human-readable field-level change extracted from an event payload. */
export interface FieldChange {
  label: string
  kind: 'changed' | 'added' | 'removed' | 'info'
  from?: string
  to?: string
}

export interface DescribedAuditEvent {
  event: AuditEventWire
  /** Short verb phrase, e.g. "renamed" / "submitted for review". */
  action: string
  /** What the operation acted on, e.g. "Dataset" / "File run1.csv". */
  subject: string
  changes: FieldChange[]
}

export const ENTITY_LABELS: Record<string, string> = {
  project: 'Project',
  folder: 'Folder',
  record: 'Record',
  block: 'Notebook block',
  record_link: 'Record link',
  file: 'File',
  dataset: 'Dataset',
  dataset_version: 'Dataset Version',
  dataset_schema: 'Dataset schema',
  sheet_instance: 'Sheet',
  sheet_definition: 'Sheet Definition',
  sheet_definition_version: 'Sheet Definition version',
  notebook_template: 'Notebook Template',
  notebook_template_version: 'Template version',
  review_submission: 'Review submission',
  review_decision: 'Review decision',
  signature: 'Signature',
  api_credential: 'API credential',
  connector: 'Connector',
  connector_run: 'Connector run',
  extension: 'Extension',
  comment: 'Comment',
  sample_event: 'Sample event',
  scientific_table: 'Table',
  scientific_row: 'Row',
  formula: 'Formula',
  revision: 'Revision',
  check: 'Checks run',
}

export const ACTION_LABELS: Record<string, string> = {
  create: 'created',
  update: 'updated',
  move: 'moved',
  delete: 'deleted',
  archive: 'archived',
  restore: 'restored',
  link: 'linked',
  unlink: 'unlinked',
  quarantine: 'quarantined',
  resolve: 'resolved',
  reopen: 'reopened',
  lock: 'locked',
  amend: 'amended',
  suspend: 'suspended',
  revoke: 'revoked',
}

interface FieldStyle {
  label: string
  render?: (value: unknown) => string
}

/** Per-field display styling; unknown fields fall back to String(value). */
const FIELD_STYLES: Partial<Record<string, FieldStyle>> = {
  title: { label: 'Title' },
  name: { label: 'Name' },
  description: { label: 'Description' },
  status: { label: 'Status', render: humanizeToken },
  lifecycle: { label: 'Lifecycle', render: humanizeToken },
  displayName: { label: 'Display name' },
  mediaType: { label: 'Media type' },
  folderId: { label: 'Folder' },
  schemaVersion: {
    label: 'Schema version',
    render: (v) => `v${String(v)}`,
  },
  definitionVersion: {
    label: 'Definition version',
    render: (v) => `v${String(v)}`,
  },
}

function humanizeToken(value: unknown): string {
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Preserve captured values in the inspector and exported audit trail. */
function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return String(value)
  if (isRichTextPayload(value)) return richTextToPlainText(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : ''
}

/** Subject noun with a stable identifier where the payload carries one. */
function subjectFor(event: AuditEventWire): string {
  const label =
    ENTITY_LABELS[event.entityType] ?? humanizeToken(event.entityType)
  const payload = event.payload
  const name =
    firstString(payload, [
      'title',
      'name',
      'displayName',
      'label',
      'identifier',
    ]) ?? undefined
  if (name) return `${label} ${name}`
  if (event.entityType === 'signature') {
    const meaning = payload['signatureMeaning']
    return `${label} (${meaning ? humanizeToken(String(meaning)) : 'recorded'})`
  }
  if (event.entityType === 'review_decision') {
    const decision = payload['decision']
    return `${label} (${decision ? humanizeToken(String(decision)) : 'recorded'})`
  }
  if (event.entityType === 'review_submission') {
    return label
  }
  return `${label} ${shortId(event.entityUuid)}`
}

function actionFor(event: AuditEventWire): string {
  const base =
    ACTION_LABELS[event.operation] ??
    humanizeToken(event.operation).toLowerCase()
  // Review decisions carry their own verb in the payload decision value.
  if (event.entityType === 'review_decision') {
    const decision = event.payload['decision']
    if (typeof decision === 'string') {
      switch (decision) {
        case 'request_changes':
          return 'requested changes on review'
        case 'reject':
          return 'rejected review'
        case 'approve':
          return 'approved review'
        case 'withdraw':
          return 'withdrew review'
        default:
          return base
      }
    }
  }
  if (event.entityType === 'revision') {
    const reason = event.payload['reason']
    switch (reason) {
      case 'submit':
        return 'froze revision for review'
      case 'amend':
        return 'opened amendment revision'
      case 'sign':
        return 'captured signature revision'
      case 'validate':
        return 'saved validation snapshot'
      default:
        return 'saved version'
    }
  }
  if (event.entityType === 'check') {
    const status = event.payload['overallStatus']
    return `ran checks (${typeof status === 'string' ? humanizeToken(status) : 'recorded'})`
  }
  if (event.entityType === 'review_submission') {
    const state = event.payload['state']
    return state === 'submitted' ? 'submitted for review' : base
  }
  if (
    event.entityType === 'sheet_instance' &&
    hasChange(event, 'definitionVersion')
  ) {
    return 'upgraded definition'
  }
  if (event.entityType === 'dataset' && hasChange(event, 'schemaVersion')) {
    return 'pinned new schema version'
  }
  if (event.entityType === 'signature') return 'signed'
  return base
}

function firstString(
  payload: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function changesOf(event: AuditEventWire): Record<string, unknown> {
  const changes = event.payload['changes']
  return changes && typeof changes === 'object' && !Array.isArray(changes)
    ? (changes as Record<string, unknown>)
    : {}
}

function hasChange(event: AuditEventWire, key: string): boolean {
  return key in changesOf(event)
}

/**
 * Extract field-level before/after values. Only values the trigger actually
 * captured are surfaced — an absent `changes` object never produces a fake
 * diff (the summary line still describes what happened).
 */
export function describeAuditEvent(event: AuditEventWire): DescribedAuditEvent {
  const changes = changesOf(event)
  const fields: FieldChange[] = []
  for (const [key, value] of Object.entries(changes)) {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      (!('from' in value) && !('to' in value))
    ) {
      continue
    }
    const style: FieldStyle | undefined =
      key === 'payload' && event.payload.type === 'rich_text'
        ? { label: 'Text' }
        : FIELD_STYLES[key]
    const fromValue = 'from' in value ? value.from : null
    const toValue = 'to' in value ? value.to : null
    const from =
      fromValue === null || fromValue === undefined
        ? null
        : style?.render
          ? style.render(fromValue)
          : formatChangeValue(fromValue)
    const to =
      toValue === null || toValue === undefined
        ? null
        : style?.render
          ? style.render(toValue)
          : formatChangeValue(toValue)
    fields.push({
      label: style?.label ?? key,
      kind: from === null ? 'added' : to === null ? 'removed' : 'changed',
      from: from ?? undefined,
      to: to ?? undefined,
    })
  }
  return {
    event,
    action: actionFor(event),
    subject: subjectFor(event),
    changes: fields,
  }
}

/** Group already-ordered events by the workspace's calendar day, not UTC. */
export function groupAuditEventsByDay(
  events: AuditEventWire[],
  timeZone: string,
): Array<{ label: string; events: AuditEventWire[] }> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const days = new Map<string, AuditEventWire[]>()
  for (const event of events) {
    const label = formatter.format(new Date(event.createdAt)).replace(',', '')
    const entries = days.get(label) ?? []
    entries.push(event)
    days.set(label, entries)
  }
  return Array.from(days, ([label, entries]) => ({ label, events: entries }))
}

/** Serialize the same selected events as the history view, without live reads. */
export function auditEventsCsv(events: AuditEventWire[]): string {
  const lines = [
    'time,sequence,actor,action,object,field,old_value,new_value,reason,client_id,payload',
  ]
  for (const event of events) {
    const described = describeAuditEvent(event)
    const changes = described.changes.length ? described.changes : [undefined]
    for (const change of changes) {
      lines.push(
        [
          event.createdAt,
          String(event.sequence),
          event.actorName ??
            event.actorUserId ??
            event.actorCredentialId ??
            'System',
          described.action,
          described.subject,
          change?.label ?? '',
          change?.from ?? '',
          change?.to ?? '',
          typeof event.payload.reason === 'string' ? event.payload.reason : '',
          event.clientId ?? '',
          JSON.stringify(event.payload),
        ]
          .map((cell) => csvEscape(cell, ','))
          .join(','),
      )
    }
  }
  return `${lines.join('\r\n')}\r\n`
}

// ---------------------------------------------------------------------------
// Correlation grouping (explicit identities only).
// ---------------------------------------------------------------------------

export interface AuditGroup {
  /** Primary event that represents the group in the timeline. */
  primary: AuditEventWire
  /** Additional events explicitly correlated to the primary. */
  related: AuditEventWire[]
}

function isCredentialRotationHalf(event: AuditEventWire): boolean {
  return (
    event.entityType === 'api_credential' &&
    (event.payload['rotatedFromCredentialId'] != null ||
      event.payload['rotatedToCredentialId'] != null)
  )
}

/**
 * Group multi-object operations when — and only when — payloads record the
 * correlation identity. Credential rotation writes revoke(old)+create(new)
 * with rotatedFromCredentialId/rotatedToCredentialId linking the pair; those
 * two halves collapse into one group. Everything else stays standalone:
 * timestamp proximity is never treated as correlation.
 */
export function groupAuditEvents(events: AuditEventWire[]): AuditGroup[] {
  const groups: AuditGroup[] = []
  const consumed = new Set<string>()

  const byEntityUuid = new Map<string, AuditEventWire[]>()
  for (const event of events) {
    if (event.entityType !== 'api_credential') continue
    const list = byEntityUuid.get(event.entityUuid) ?? []
    list.push(event)
    byEntityUuid.set(event.entityUuid, list)
  }

  for (const event of events) {
    if (consumed.has(event.id)) continue
    if (isCredentialRotationHalf(event)) {
      const revokedId = event.payload['rotatedFromCredentialId']
      const createdId = event.payload['rotatedToCredentialId']
      const related: AuditEventWire[] = []
      for (const counterpartId of [revokedId, createdId]) {
        if (typeof counterpartId !== 'string') continue
        for (const candidate of byEntityUuid.get(counterpartId) ?? []) {
          if (candidate.id === event.id || consumed.has(candidate.id)) continue
          if (isCredentialRotationHalf(candidate)) {
            related.push(candidate)
            consumed.add(candidate.id)
          }
        }
      }
      consumed.add(event.id)
      groups.push({ primary: event, related })
      continue
    }
    consumed.add(event.id)
    groups.push({ primary: event, related: [] })
  }
  return groups
}

// ---------------------------------------------------------------------------
// Deep links (canonical routes only).
// ---------------------------------------------------------------------------

export interface AuditLink {
  href: string
  label: string
}

/**
 * Resolve the canonical deep link for an event's subject, using existing
 * product routes. Returns null when no canonical surface exists — history
 * never invents destinations.
 */
export function auditLinkFor(event: AuditEventWire): AuditLink | null {
  switch (event.entityType) {
    case 'record':
      return {
        href: recordPath(event.entityUuid),
        label: 'Open record',
      }
    case 'block':
    case 'file':
    case 'comment':
      return event.recordId
        ? {
            href: recordPath(event.recordId),
            label: 'Open record',
          }
        : null
    case 'review_submission':
    case 'signature':
    case 'review_decision': {
      const revisionId = event.payload['revisionId']
      return typeof revisionId === 'string'
        ? { href: `/review/${revisionId}`, label: 'Open review' }
        : null
    }
    case 'revision': {
      const revisionId = event.payload['revisionId']
      return {
        href: `/review/${typeof revisionId === 'string' ? revisionId : event.entityUuid}`,
        label: 'Open review',
      }
    }
    case 'dataset':
    case 'dataset_version':
      return {
        href: datasetPath(
          String(event.payload['datasetId'] ?? event.entityUuid),
        ),
        label: 'Open dataset',
      }
    case 'sheet_instance':
      return { href: sheetPath(event.entityUuid), label: 'Open sheet' }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// SIGN-002 record timeline adapter.
// ---------------------------------------------------------------------------

/**
 * Map `api.record_timeline` rows (the authoritative per-record aggregate of
 * change events, revisions, submissions, decisions, checks, signatures and
 * comments) onto the shared audit-event shape so the record History surface
 * renders through the same semantic component as every other object class.
 */
export function timelineToAuditEvents(
  events: TimelineEventWire[],
): AuditEventWire[] {
  return events.map((entry) => {
    const { type, id, seq, ts, actorUserId, ...rest } = entry
    const derived: Record<string, unknown> = { ...rest }
    delete derived.title

    let entityType: string = type
    let operation = 'update'
    switch (type) {
      case 'change_event':
        entityType = typeof rest.eventType === 'string' ? rest.eventType : type
        operation =
          typeof rest.operation === 'string' ? rest.operation : 'update'
        if (rest.payload && typeof rest.payload === 'object') {
          Object.assign(derived, rest.payload)
        }
        delete derived.eventType
        delete derived.operation
        break
      case 'revision':
        entityType = 'revision'
        operation = 'create'
        derived.revisionId = id
        break
      case 'submission':
        entityType = 'review_submission'
        operation = 'create'
        break
      case 'decision':
        entityType = 'review_decision'
        operation = 'create'
        break
      case 'check':
        entityType = 'check'
        operation = 'create'
        break
      case 'signature':
        entityType = 'signature'
        operation = 'create'
        break
      case 'comment':
        entityType = 'comment'
        operation = 'create'
        break
    }

    return {
      sequence: typeof seq === 'number' ? seq : 0,
      id,
      createdAt: ts,
      entityType,
      entityUuid: id,
      operation,
      recordId: null,
      projectId: null,
      actorUserId: actorUserId ?? null,
      actorName: null,
      actorCredentialId: null,
      clientId: null,
      payload: derived,
    }
  })
}
