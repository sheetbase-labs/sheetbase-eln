/**
 * FIND-01 — Recents & work resumption data layer.
 *
 * Recents are derived from two complementary signals, never from browser
 * history:
 *
 * - **Viewed** — the thin per-user `api.recently_viewed` table (FIND-01
 *   migration). Written through the `record_recent_view` SECURITY DEFINER
 *   RPC when a canonical object page is opened; read back under RLS.
 * - **Edited / reviewed** — the canonical `change_events` audit trail. Every
 *   durable mutation already emits an event with actor attribution, so "what
 *   was I last working on" is a read over existing canonical activity. No
 *   server persistence is added for these signals.
 *
 * Ordering is deterministic: per object, last activity =
 * max(viewed_at, latest edit, latest review), newest first, capped. Labels
 * come from the canonical records and destinations exclusively from
 * `src/lib/navigation.ts` — never hand-built URLs.
 */
import { sampleStatus } from '#/components/v3/samples/samples-data'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'
import type { ChangeEventRecordWire, ProjectWire } from './notebook-data'
import {
  datasetPath,
  notebookTemplatePath,
  projectPath,
  recordDestination,
  sheetPath,
} from './navigation'

/** What recents read of a change event; the payload is by far its largest part. */
type ChangeEventSignalWire = Omit<ChangeEventRecordWire, 'payload'>

// ---------------------------------------------------------------------------
// Domain shapes.
// ---------------------------------------------------------------------------

/** Canonical object kinds that participate in recents. */
export type RecentObjectKind =
  'record' | 'dataset' | 'sheet' | 'project' | 'notebook_template'

/** How the user last touched an object. */
export type RecentSignal = 'edited' | 'reviewed' | 'viewed'

/** Wire shape of `api.recently_viewed` (snake_case via PostgREST). */
export interface RecentViewWire {
  user_id: string
  object_kind: RecentObjectKind
  object_id: string
  viewed_at: string
}

export interface RecentView {
  kind: RecentObjectKind
  id: string
  viewedAt: string
}

/**
 * One canonical-activity signal: the user edited or submitted-for-review an
 * object at a point in time. Derived from `change_events`, never stored.
 */
export interface RecentSignalEvent {
  kind: RecentObjectKind
  id: string
  at: string
  signal: 'edited' | 'reviewed'
}

/** Derivation output before canonical labels/destinations are resolved. */
export interface DerivedRecentItem {
  kind: RecentObjectKind
  id: string
  /** max(view, edit, review) — the ordering timestamp. */
  lastActivityAt: string
  /** The most recent signal; ties resolve edited > reviewed > viewed. */
  signal: RecentSignal
  viewedAt: string | null
  editedAt: string | null
  reviewedAt: string | null
}

/** A resolved recent item ready to render. */
export interface RecentItem {
  kind: RecentObjectKind
  id: string
  label: string
  /** Secondary identity line (identifier/key) when the canonical object has one. */
  identifier: string | null
  destination: string
  signal: RecentSignal
  lastActivityAt: string
  viewedAt: string | null
  editedAt: string | null
  /**
   * Canonical lifecycle/state for the object when it has one: a record's
   * `status`, a dataset/sheet/template `lifecycle`, or a project's `status`.
   * The Home "Continue working" table shows it as the Status column rather
   * than inventing a second state store.
   */
  status: string | null
}

// ---------------------------------------------------------------------------
// Query keys.
// ---------------------------------------------------------------------------

export const recentsQueryKeys = {
  recents: (userId: string, limit: number) =>
    ['recents', 'recents', userId, limit] as const,
}

/** How many items the compact Recent surface shows. */
export const RECENTS_LIMIT = 20

/**
 * Recents replenishment: the derivation runs over a candidate set this many
 * times larger than the visible cap, and the cap is applied to RESOLVED
 * (still-visible) items only. Capping raw candidates first would let
 * archived/deleted/no-longer-visible objects starve the surface.
 */
export const RECENTS_CANDIDATE_MULTIPLIER = 3

/** Raw change_events fetched per page while hunting for distinct objects. */
export const RECENTS_SIGNAL_PAGE_SIZE = 300

/** Hard page bound for the signal hunt; anything older falls out naturally. */
export const RECENTS_SIGNAL_MAX_PAGES = 2

// ---------------------------------------------------------------------------
// Signal derivation from the canonical change-event audit trail.
// ---------------------------------------------------------------------------

/** Change-event operations that represent genuine work on an object. */
const EDIT_OPERATIONS = new Set(['create', 'update', 'amend'])

/**
 * Maps canonical change events authored by the current user to per-object
 * recency signals. Only entity types that directly identify a resumable
 * object are mapped; block/link events attribute to their owning record via
 * the `record_id` scoping hint the emit trigger writes.
 */
export function signalEventsFromChangeEvents(
  rows: ChangeEventSignalWire[],
): RecentSignalEvent[] {
  const signals: RecentSignalEvent[] = []
  for (const row of rows) {
    if (!EDIT_OPERATIONS.has(row.operation)) continue
    const at = row.created_at
    switch (row.entity_type) {
      case 'record':
        signals.push({
          kind: 'record',
          id: row.entity_uuid,
          at,
          signal: 'edited',
        })
        break
      case 'block':
      case 'record_link':
        if (row.record_id) {
          signals.push({
            kind: 'record',
            id: row.record_id,
            at,
            signal: 'edited',
          })
        }
        break
      case 'review_submission':
        if (row.record_id) {
          signals.push({
            kind: 'record',
            id: row.record_id,
            at,
            signal: 'reviewed',
          })
        }
        break
      case 'sheet_instance':
        signals.push({
          kind: 'sheet',
          id: row.entity_uuid,
          at,
          signal: 'edited',
        })
        break
      case 'dataset':
        signals.push({
          kind: 'dataset',
          id: row.entity_uuid,
          at,
          signal: 'edited',
        })
        break
      case 'project':
        signals.push({
          kind: 'project',
          id: row.entity_uuid,
          at,
          signal: 'edited',
        })
        break
      case 'notebook_template':
        signals.push({
          kind: 'notebook_template',
          id: row.entity_uuid,
          at,
          signal: 'edited',
        })
        break
      default:
        break
    }
  }
  return signals
}

// ---------------------------------------------------------------------------
// Derivation — merge views and canonical signals into one ordered list.
// ---------------------------------------------------------------------------

interface RecentAccumulator {
  kind: RecentObjectKind
  id: string
  viewedAt: string | null
  editedAt: string | null
  reviewedAt: string | null
}

function newer(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return Date.parse(b) > Date.parse(a) ? b : a
}

/**
 * Merges per-user views with canonical edit/review signals into a
 * deterministic, capped recency list.
 *
 * - One entry per object, keyed by (kind, id).
 * - `lastActivityAt` is max(viewedAt, editedAt, reviewedAt).
 * - `signal` reflects whichever timestamp is newest; ties resolve
 *   edited > reviewed > viewed so an object just edited after being viewed
 *   reads as "edited".
 * - Ordering: lastActivityAt desc, then kind asc, then id asc (stable across
 *   fetches).
 */
export function buildRecentItems(args: {
  views: RecentView[]
  signals: RecentSignalEvent[]
  limit?: number
}): DerivedRecentItem[] {
  const limit = args.limit ?? RECENTS_LIMIT
  const byKey = new Map<string, RecentAccumulator>()
  const keyFor = (kind: RecentObjectKind, id: string) => `${kind}:${id}`

  for (const view of args.views) {
    const key = keyFor(view.kind, view.id)
    const acc = byKey.get(key) ?? {
      kind: view.kind,
      id: view.id,
      viewedAt: null,
      editedAt: null,
      reviewedAt: null,
    }
    acc.viewedAt = newer(acc.viewedAt, view.viewedAt)
    byKey.set(key, acc)
  }

  for (const signal of args.signals) {
    const key = keyFor(signal.kind, signal.id)
    const acc = byKey.get(key) ?? {
      kind: signal.kind,
      id: signal.id,
      viewedAt: null,
      editedAt: null,
      reviewedAt: null,
    }
    if (signal.signal === 'edited')
      acc.editedAt = newer(acc.editedAt, signal.at)
    else acc.reviewedAt = newer(acc.reviewedAt, signal.at)
    byKey.set(key, acc)
  }

  const items: DerivedRecentItem[] = []
  for (const acc of byKey.values()) {
    const lastActivityAt = newer(
      newer(acc.editedAt, acc.reviewedAt),
      acc.viewedAt,
    )
    if (!lastActivityAt) continue
    let signal: RecentSignal = 'viewed'
    if (acc.editedAt === lastActivityAt) signal = 'edited'
    else if (acc.reviewedAt === lastActivityAt) signal = 'reviewed'
    items.push({ ...acc, lastActivityAt, signal })
  }

  items.sort((a, b) => {
    const diff = Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)
    if (diff !== 0) return diff
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
  return items.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Fetch helpers — through the same /api/db PostgREST boundary as the rest of
// the app, so every read respects the same RLS boundaries.
// ---------------------------------------------------------------------------

export function toRecentView(row: RecentViewWire): RecentView {
  return {
    kind: row.object_kind,
    id: row.object_id,
    viewedAt: row.viewed_at,
  }
}

/** Per-user view rows, newest first. RLS restricts to the current user. */
export function fetchRecentViews(
  client: DataClient = notebookDataClient,
  limit = 50,
): Promise<RecentView[]> {
  return client
    .list<RecentViewWire>(
      'recently_viewed',
      `?order=viewed_at.desc&limit=${limit}&select=user_id,object_kind,object_id,viewed_at`,
    )
    .then((rows) => rows.map(toRecentView))
}

/**
 * The current user's recent canonical edit/review events.
 *
 * Raw change_events are fetched in pages of `pageSize`, newest first, until
 * EITHER the target number of DISTINCT objects carrying signals has been
 * seen, the feed is exhausted, or `maxPages` is reached. Deduplicating by
 * distinct object BEFORE the raw-window limit matters: without it, a burst
 * of edits to a single object can fill the first page and push every other
 * recently-worked object out of recents entirely. Anything older than the
 * page budget falls out of recents naturally.
 */
export async function fetchMyRecentSignals(
  client: DataClient,
  userId: string,
  options: {
    /** Stop once this many distinct objects carry signals. */
    targetDistinct?: number
    /** Raw change_events rows per page. */
    pageSize?: number
    /** Hard page bound so pathological histories cannot fetch forever. */
    maxPages?: number
  } = {},
): Promise<RecentSignalEvent[]> {
  const targetDistinct =
    options.targetDistinct ?? RECENTS_LIMIT * RECENTS_CANDIDATE_MULTIPLIER
  const pageSize = options.pageSize ?? RECENTS_SIGNAL_PAGE_SIZE
  const maxPages = options.maxPages ?? RECENTS_SIGNAL_MAX_PAGES
  const baseQuery =
    `?actor_user_id=eq.${userId}&operation=in.(create,update,amend)` +
    `&order=created_at.desc&select=id,entity_type,entity_uuid,operation,record_id,actor_user_id,created_at`

  const signals: RecentSignalEvent[] = []
  let offset = 0
  for (let page = 0; page < maxPages; page += 1) {
    const query =
      `${baseQuery}&limit=${pageSize}` + (offset > 0 ? `&offset=${offset}` : '')
    const rows = await client.list<ChangeEventSignalWire>(
      'change_events',
      query,
    )
    signals.push(...signalEventsFromChangeEvents(rows))
    offset += rows.length
    const distinct = new Set(signals.map((s) => `${s.kind}:${s.id}`)).size
    // Feed exhausted, or enough distinct objects already: stop paging.
    if (rows.length < pageSize || distinct >= targetDistinct) break
  }
  return signals
}

/**
 * Record a view of a canonical object. Fire-and-forget by callers; the RPC
 * upserts one row per (user, kind, object) and is a no-op for objects the
 * caller can no longer see. Returns the upserted timestamp, or null when the
 * view was ignored. PostgREST renders the scalar timestamptz return as a
 * bare JSON string.
 */
export function recordRecentView(
  client: DataClient,
  kind: RecentObjectKind,
  objectId: string,
): Promise<string | null> {
  return client
    .rpc<string | { viewed_at?: string } | null>('record_recent_view', {
      p_object_kind: kind,
      p_object_id: objectId,
    })
    .then((row) => {
      if (typeof row === 'string') return row
      return row?.viewed_at ?? null
    })
}

// ---------------------------------------------------------------------------
// Resolution — canonical labels and destinations.
// ---------------------------------------------------------------------------

interface RecordLabelWire {
  id: string
  kind: string
  identifier: string
  title: string
  status: string
  archived_at: string | null
  deleted_at: string | null
}

interface DatasetLabelWire {
  id: string
  name: string
  lifecycle: string
}

interface SheetLabelWire {
  id: string
  name: string
  lifecycle: string
}

interface TemplateLabelWire {
  id: string
  key: string
  name: string
  lifecycle: string
}

/**
 * The proxy refuses any query value over 500 characters, which a list of about
 * fourteen ids exceeds, so label lookups go out in batches.
 */
const ID_BATCH_SIZE = 10

async function listByIds<T>(
  client: DataClient,
  resource: string,
  ids: string[] | undefined,
  select: string,
): Promise<T[]> {
  if (!ids) return []
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += ID_BATCH_SIZE)
    batches.push(ids.slice(i, i + ID_BATCH_SIZE))
  const pages = await Promise.all(
    batches.map((batch) =>
      client.list<T>(resource, `?id=in.(${batch.join(',')})&select=${select}`),
    ),
  )
  return pages.flat()
}

/**
 * Resolves derived items to renderable RecentItems with canonical labels and
 * navigation destinations. Items whose canonical object is gone, archived,
 * retired or otherwise not resumable are dropped — recents never link to
 * objects the user could not open right now. Input order (the derivation
 * order) is preserved.
 */
export async function resolveRecentItems(
  client: DataClient,
  items: DerivedRecentItem[],
): Promise<RecentItem[]> {
  if (items.length === 0) return []

  const idsByKind = new Map<RecentObjectKind, string[]>()
  for (const item of items) {
    const ids = idsByKind.get(item.kind) ?? []
    ids.push(item.id)
    idsByKind.set(item.kind, ids)
  }

  const [recordRows, datasetRows, sheetRows, projectRows, templateRows] =
    await Promise.all([
      listByIds<RecordLabelWire & { project_id: string | null }>(
        client,
        'records',
        idsByKind.get('record'),
        'id,kind,identifier,title,status,archived_at,deleted_at',
      ),
      listByIds<DatasetLabelWire>(
        client,
        'datasets',
        idsByKind.get('dataset'),
        'id,name,lifecycle',
      ),
      listByIds<SheetLabelWire>(
        client,
        'sheet_instances',
        idsByKind.get('sheet'),
        'id,name,lifecycle',
      ),
      listByIds<ProjectWire>(
        client,
        'projects',
        idsByKind.get('project'),
        'id,key,title,status,archived_at',
      ),
      listByIds<TemplateLabelWire>(
        client,
        'notebook_templates',
        idsByKind.get('notebook_template'),
        'id,key,name,lifecycle',
      ),
    ])

  const recordById = new Map(
    recordRows.map((r) => [
      r.id,
      {
        kind: r.kind,
        identifier: r.identifier,
        title: r.title,
        status: r.status,
        resumable: r.deleted_at === null && r.archived_at === null,
      },
    ]),
  )
  const datasetById = new Map(
    datasetRows.map((d) => [
      d.id,
      {
        name: d.name,
        status: d.lifecycle,
        resumable: d.lifecycle === 'active',
      },
    ]),
  )
  const sheetById = new Map(
    sheetRows.map((s) => [
      s.id,
      {
        name: s.name,
        status: s.lifecycle,
        resumable: s.lifecycle === 'active',
      },
    ]),
  )
  const templateById = new Map(
    templateRows.map((t) => [
      t.id,
      {
        key: t.key,
        name: t.name,
        status: t.lifecycle,
        resumable: t.lifecycle === 'active',
      },
    ]),
  )
  const projectById = new Map(
    projectRows.map((p) => [
      p.id,
      {
        key: p.key,
        title: p.title,
        status: p.status,
        resumable: p.archived_at === null,
      },
    ]),
  )

  const resolved: RecentItem[] = []
  for (const item of items) {
    switch (item.kind) {
      case 'record': {
        const record = recordById.get(item.id)
        if (!record || !record.resumable) break
        resolved.push({
          ...item,
          label: record.title,
          identifier: record.identifier,
          destination: recordDestination(record.kind, item.id),
          status: record.status,
        })
        break
      }
      case 'dataset': {
        const dataset = datasetById.get(item.id)
        if (!dataset || !dataset.resumable) break
        resolved.push({
          ...item,
          label: dataset.name,
          identifier: null,
          destination: datasetPath(item.id),
          status: dataset.status,
        })
        break
      }
      case 'sheet': {
        const sheet = sheetById.get(item.id)
        if (!sheet || !sheet.resumable) break
        resolved.push({
          ...item,
          label: sheet.name,
          identifier: null,
          destination: sheetPath(item.id),
          status: sheet.status,
        })
        break
      }
      case 'project': {
        const project = projectById.get(item.id)
        if (!project || !project.resumable) break
        resolved.push({
          ...item,
          label: project.title,
          identifier: project.key,
          destination: projectPath(item.id),
          status: project.status,
        })
        break
      }
      case 'notebook_template': {
        const template = templateById.get(item.id)
        if (!template || !template.resumable) break
        resolved.push({
          ...item,
          label: template.name,
          identifier: template.key,
          destination: notebookTemplatePath(item.id),
          status: template.status,
        })
        break
      }
    }
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Presentation helpers — pure derivations over resolved items.
// ---------------------------------------------------------------------------

const OBJECT_NOUNS: Record<RecentObjectKind, string> = {
  record: 'record',
  dataset: 'dataset',
  sheet: 'sheet',
  project: 'project',
  notebook_template: 'template',
}

/**
 * A short, human description of the user's most recent action on an item, for
 * the Home "Your last change" column. Derived from the resolved signal and
 * object kind only; no additional read or state is introduced.
 */
export function describeRecentChange(
  item: Pick<RecentItem, 'kind' | 'signal'>,
): string {
  const noun = OBJECT_NOUNS[item.kind]
  if (item.signal === 'reviewed') return 'Submitted for review'
  if (item.signal === 'edited') return `Edited ${noun}`
  return `Viewed ${noun}`
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  planned: 'Planned',
  in_progress: 'In progress',
  in_review: 'In review',
  under_review: 'In review',
  review: 'In review',
  approved: 'Approved',
  locked: 'Locked',
  paused: 'On hold',
  failed: 'Failed',
  complete: 'Complete',
  completed: 'Complete',
  active: 'Active',
  archived: 'Archived',
  retired: 'Retired',
}

/**
 * Human label for an item's canonical status. Returns null when the object has
 * no status; unknown values are title-cased rather than hidden.
 */
export function recentStatusLabel(
  item: Pick<RecentItem, 'status'> & { destination?: string },
): string | null {
  if (!item.status) return null
  // Samples word their lifecycle their own way ("Stored", not "Available").
  if (item.destination?.startsWith('/samples/'))
    return sampleStatus(item.status).label
  return (
    STATUS_LABELS[item.status] ??
    item.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

// ---------------------------------------------------------------------------
// One-shot read for the home surface: fetch both signals, derive, resolve.
// ---------------------------------------------------------------------------

/**
 * Fetches the user's recents end-to-end: per-user views + canonical
 * edit/review events → deterministic merge → label/destination resolution.
 *
 * Replenishment order matters: the derivation runs over a candidate set
 * `RECENTS_CANDIDATE_MULTIPLIER`× the visible limit, items whose canonical
 * object no longer resolves (archived/deleted/retired) are dropped, and only
 * then is the visible cap applied to the resolved items. Capping raw
 * candidates first would let hidden objects crowd visible ones off the
 * surface.
 */
export async function fetchRecentItems(
  client: DataClient,
  userId: string,
  limit = RECENTS_LIMIT,
): Promise<RecentItem[]> {
  const candidateLimit = limit * RECENTS_CANDIDATE_MULTIPLIER
  const [views, signals] = await Promise.all([
    fetchRecentViews(client, candidateLimit * 2),
    fetchMyRecentSignals(client, userId, { targetDistinct: candidateLimit }),
  ])
  const derived = buildRecentItems({ views, signals, limit: candidateLimit })
  const resolved = await resolveRecentItems(client, derived)
  return resolved.slice(0, limit)
}

// ---------------------------------------------------------------------------
// View tracking — one fire-and-forget write per object page mount.
// ---------------------------------------------------------------------------

/**
 * Records a view of a canonical object while the calling page is mounted.
 * Failures are swallowed on purpose: view tracking is presentation-support
 * state and must never disturb the object page itself.
 */
export function useRecentViewTracking(
  kind: RecentObjectKind,
  objectId: string | null | undefined,
): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!objectId) return
    recordRecentView(notebookDataClient, kind, objectId)
      .then((viewedAt) => {
        if (!viewedAt) return
        void queryClient.invalidateQueries({ queryKey: ['recents'] })
        void queryClient.invalidateQueries({ queryKey: ['home-recents'] })
        if (kind === 'project') {
          void queryClient.invalidateQueries({
            queryKey: ['home-first-run-project-opens'],
          })
        }
      })
      .catch(() => {
        /* best-effort: a failed view write never blocks the page */
      })
  }, [kind, objectId, queryClient])
}
