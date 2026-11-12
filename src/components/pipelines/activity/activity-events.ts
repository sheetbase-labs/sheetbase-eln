import type { ApprovalRequest } from '#/lib/approval-requests'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import { buildApprovalTrail } from '#/components/models/model-approval'
import type {
  ApprovalDecision,
  ApprovalTrailKind,
} from '#/components/models/model-approval'

export type ActivityKind =
  | 'created'
  | 'requested'
  | 'approved'
  | 'returned'
  | 'withdrawn'
  | 'published'
  | 'retired'

export interface ActivityEvent {
  id: string
  kind: ActivityKind
  at: string
  version: number
  actorId: string | null
  note: string | null
}

const TRAIL_KIND: Record<ApprovalTrailKind, ActivityKind> = {
  submitted: 'requested',
  approved: 'approved',
  returned: 'returned',
  withdrawn: 'withdrawn',
}

/**
 * Everything that happened to a pipeline's versions, newest first: drafts
 * started, publish requests with their decisions, and versions published or
 * retired. Conversions and other history join here when they exist.
 */
export function buildActivity(
  versions: readonly PipelineDefinitionVersionWire[],
  requests: readonly ApprovalRequest[],
  decisions: readonly ApprovalDecision[],
): ActivityEvent[] {
  const byId = new Map(versions.map((version) => [version.id, version]))
  const events: ActivityEvent[] = []

  for (const version of versions) {
    events.push({
      id: `${version.id}:created`,
      kind: 'created',
      at: version.created_at,
      version: version.version,
      actorId: version.created_by_user_id,
      note: null,
    })

    if (version.published_at)
      events.push({
        id: `${version.id}:published`,
        kind: 'published',
        at: version.published_at,
        version: version.version,
        actorId: version.published_by_user_id,
        note: null,
      })

    if (version.retired_at)
      events.push({
        id: `${version.id}:retired`,
        kind: 'retired',
        at: version.retired_at,
        version: version.version,
        actorId: version.retired_by_user_id,
        note: null,
      })
  }

  for (const request of requests) {
    const version = byId.get(request.object_id)

    if (!version) continue

    for (const entry of buildApprovalTrail(request, decisions))
      events.push({
        id: entry.id,
        kind: TRAIL_KIND[entry.kind],
        at: entry.at,
        version: version.version,
        actorId: entry.actorUserId,
        note: entry.reason,
      })
  }

  // Newest first; at the same moment the later step of the story sits above.
  const order: ActivityKind[] = [
    'created',
    'requested',
    'returned',
    'withdrawn',
    'approved',
    'published',
    'retired',
  ]

  return events.sort(
    (a, b) =>
      Date.parse(b.at) - Date.parse(a.at) ||
      order.indexOf(b.kind) - order.indexOf(a.kind),
  )
}

/** Who appears in the feed, so their names can be looked up once. */
export function activityActorIds(events: readonly ActivityEvent[]): string[] {
  return [...new Set(events.flatMap((e) => (e.actorId ? [e.actorId] : [])))]
}
