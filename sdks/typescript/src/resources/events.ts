/**
 * Domain event vocabulary and webhook delivery helpers.
 *
 * Hand-mirrored from the canonical catalogue in
 * `src/lib/event-catalogue.ts` (EVENT-01). The catalogue is authoritative;
 * the drift suite pins `EVENT_NAMES` equal to the catalogue's canonical
 * names. Consumers subscribe with canonical names — wire aliases (shipped
 * table-name leaks such as `sheet_instance.created`) keep working through
 * `resolveEventAlias`, but new code should use the canonical form.
 *
 * `verifyWebhookSignature` is isomorphic (Web Crypto only): integration
 * endpoints authenticate deliveries with the subscription's signing secret,
 * comparing against the `X-Sheetbase-Signature: sha256=<hex>` header.
 * Deduplicate on `eventId` — retries and replays reuse the same id and must
 * not duplicate downstream effects.
 */

export const EVENT_NAMES = [
  'project.created',
  'project.updated',
  'project.deleted',
  'project.archived',
  'project.restored',
  'record.created',
  'record.updated',
  'record.moved',
  'record.deleted',
  'record.archived',
  'record.restored',
  'record.amended',
  'dataset.created',
  'dataset.updated',
  'dataset.archived',
  'dataset.restored',
  'dataset.versioned',
  'sheet.created',
  'sheet.updated',
  'sheet.archived',
  'sheet.restored',
  'sheet.definition.created',
  'sheet.definition.updated',
  'sheet.definition.versioned',
  'notebook.submitted',
  'notebook.amended',
  'review.decided',
  'record.signed',
  'notebook.template.created',
  'notebook.template.updated',
  'notebook.template.versioned',
  'sample.received',
  'sample.moved',
  'sample.consumed',
  'sample.released',
  'sample.quarantined',
  'sample.disposed',
  'sample.hold_exceeded',
  'booking.created',
  'booking.updated',
  'booking.cancelled',
  'import.created',
  'import.committed',
  'import.failed',
  'approval.requested',
  'approval.approved',
  'approval.returned',
  'approval.withdrawn',
  'order.priced',
  'order.price_removed',
  'instrument.rate_set',
  'instrument.rate_removed',
  'report.schedule.created',
  'report.schedule.updated',
  'report.schedule.deleted',
  'lake.table.updated',
  'lake.settings.updated',
  'publication.created',
  'publication.drafted',
  'publication.published',
  'publication.failed',
  'publication_target.updated',
  'ontology.term.linked',
  'ontology.term.unlinked',
  'ontology.settings.updated',
  'validation.run_completed',
  'contract.created',
  'contract.updated',
  'contract.deleted',
  'contract.check.completed',
  'contract.breached',
  'contract.restored',
  'signature.timestamped',
  'signature.timestamp_failed',
  'workspace.timestamping.updated',
  'storage.placed',
  'storage.moved',
  'storage.removed',
  'storage.alarm.raised',
  'storage.alarm.cleared',
  'instrument.run.created',
  'instrument.run.completed',
  'instrument.run.failed',
  'pipeline.created',
  'pipeline.updated',
  'pipeline.deleted',
  'pipeline.version.created',
  'pipeline.version.updated',
  'pipeline.run.created',
  'pipeline.run.updated',
  'pipeline.schedule.created',
  'pipeline.schedule.updated',
  'workspace.invitation.created',
  'workspace.invitation.updated',
  'workspace.invitation.deleted',
  'workspace.settings.created',
  'workspace.settings.updated',
  'project.access.granted',
  'project.access.updated',
  'project.access.revoked',
  'workspace.credential.created',
  'workspace.credential.revoked',
  'member.work_handed_over',
  'member.absence_set',
  'member.absence_cancelled',
  'workspace.settings_access.changed',
  'workspace.renamed',
  'project.access.requested',
  'project.access.request_decided',
  'workspace.group.created',
  'workspace.group.deleted',
  'workspace.group.member_added',
  'workspace.group.member_removed',
  'member.joined',
  'member.role_changed',
  'member.suspended',
  'member.reinstated',
  'member.removed',
  'client.created',
  'client.updated',
  'client.archived',
  'client.restored',
  'client.record_shared',
  'client.record_unshared',
  'client.message_posted',
  'workspace.group_role.mapped',
  'workspace.group_role.removed',
  'workspace.group_role.adopted',
  'member.role_changed_by_groups',
  'member.passkey_added',
  'member.passkey_removed',
  'agent.policy.changed',
  'agent.action.requested',
  'agent.action.decided',
  'agent.action.completed',
  'extension.point.enabled',
  'extension.point.disabled',
  'extension.invoked',
  'extension.field_type.applied',
  'extension.field_type.removed',
  'extension.settings.changed',
  'ai.eval.completed',
  'watcher.finding.created',
  // Lab features: stock, shipping, requests, holds, workflows.
  'reagent.order.requested',
  'reagent.order.placed',
  'reagent.order.received',
  'reagent.order.cancelled',
  'stocktake.completed',
  'shipment.sent',
  'shipment.in_transit',
  'shipment.received',
  'shipment.cancelled',
  'request.submitted',
  'request.decided',
  'legal_hold.created',
  'legal_hold.released',
  'retention.applied',
  'sample.workflow.advanced',
  'sample.workflow.enrolled',
  'sample.workflow.left',
  'incident.reported',
  'registry.entry.created',
  'instrument.reading.out_of_limits',
  'instrument.reading.back_in_range',
  'record.assigned',
  'step.completed',
  'step.reopened',
  'step.result_added',
  'compound.lot_added',
  'experiment.series_member_added',
  'experiment.series_member_removed',
  'plate_run.created',
  'plate_run.analysed',
  'plate_run.archived',
  'plate_worklist.created',
  'plate_worklist.completed',
  'member.provisioned',
  'member.directory_updated',
  'member.deprovisioned',
  'member.reactivated',
  'workspace.scim_group.created',
  'workspace.scim_group.updated',
  'workspace.scim_group.deleted',
  'workspace.scim_token.created',
  'workspace.scim_token.revoked',
  'experiment.part_created',
  'experiment.part_opened',
  'experiment.part_completed',
  'experiment.part_reopened',
  'experiment.gate_opened',
  'experiment.gate_overridden',
  'instrument.run.converted',
  'qc.violation',
  'qc.back_in_control',
  'instrument.job.queued',
  'instrument.job.staged',
  'instrument.job.started',
  'instrument.job.completed',
  'instrument.job.failed',
  'instrument.job.cancelled',
  'instrument.created',
  'instrument.updated',
  'instrument.retired',
  'instrument.reinstated',
  'instrument.out_of_service',
  'instrument.back_in_service',
  'instrument.calibrated',
  'instrument.qualification_set',
  'instrument.qualification_revoked',
  'instrument.qualification_requested',
  'instrument.qualification_request_closed',
  'resource.created',
  'connector.created',
  'connector.updated',
  'connector.run.started',
  'connector.run.completed',
  'connector.run.failed',
  'parser.created',
  'parser.version.created',
  'parser.version.approved',
  'schedule.proposed',
  'schedule.accepted',
  'schedule.dismissed',
  'code_cell.run',
  'code_cell.reproduced',
  'pipeline.run.reproduced',
  'lineage.endpoint.created',
  'lineage.endpoint.updated',
  'lineage.delivery_failed',
  'experiment.part_signed',
  'experiment.part_countersigned',
  'experiment.part_amended',
] as const

export type EventName = (typeof EVENT_NAMES)[number]

/**
 * Shipped wire aliases (table-name leaks kept for compatibility) mapped to
 * their canonical names. New subscriptions should use the canonical form.
 */
export const EVENT_ALIASES: Record<string, EventName> = {
  'sheet_instance.created': 'sheet.created',
  'sheet_instance.updated': 'sheet.updated',
  'sheet_instance.archived': 'sheet.archived',
  'sheet_instance.restored': 'sheet.restored',
  'sheet_definition.created': 'sheet.definition.created',
  'sheet_definition.updated': 'sheet.definition.updated',
  'sheet_definition.versioned': 'sheet.definition.versioned',
  'notebook_template.created': 'notebook.template.created',
  'notebook_template.updated': 'notebook.template.updated',
  'notebook_template.versioned': 'notebook.template.versioned',
  'notebook.signed': 'record.signed',
}

/** Resolve a wire alias (or canonical name) to its canonical event name. */
export function resolveEventAlias(name: string): string {
  return EVENT_ALIASES[name] ?? name
}

/** True when the value is a known canonical event name. */
export function isEventName(value: string): value is EventName {
  return (EVENT_NAMES as readonly string[]).includes(value)
}

/**
 * The JSON body delivered to a webhook endpoint. Mirrors the server's
 * `WebhookEventPayload` (`src/lib/webhook-events.ts`): `eventId` is the
 * idempotency key, `sequence` orders events within a workspace, and
 * `payload` is a lightweight summary — never the source of truth.
 */
export interface WebhookEventPayload {
  schemaVersion: '1'
  /** Stable event type as emitted on the wire (canonical or alias). */
  eventType: string
  /** Globally unique event id (the `change_events` id). */
  eventId: string
  /** Per-workspace sequence number for ordering. */
  sequence: number
  /** Workspace the event belongs to. */
  workspaceId: string
  /** Entity uuid the event is about. */
  entityUuid: string
  /** Internal entity type for diagnostic purposes. */
  entityType: string
  /** Internal operation for diagnostic purposes. */
  operation: string
  /** Record context when the event is record-scoped. */
  recordId: string | null
  /** Project context when the event is project-scoped. */
  projectId: string | null
  /** Actor attribution. */
  actorUserId: string | null
  actorCredentialId: string | null
  /** Lightweight event summary (never the full source of truth). */
  payload: Record<string, unknown>
  /** Event creation timestamp (ISO 8601). */
  createdAt: string
}

/**
 * Verify a webhook delivery against the `X-Sheetbase-Signature` header
 * (`sha256=<hex>` HMAC-SHA256 over the raw JSON body, per
 * `src/lib/webhook-signing.ts`). Returns true only on a full match.
 */
export async function verifyWebhookSignature(
  body: string,
  secret: string,
  signature: string,
): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error(
      'Web Crypto (globalThis.crypto.subtle) is required to verify webhook signatures.',
    )
  }
  const encoder = new TextEncoder()
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await subtle.sign('HMAC', key, encoder.encode(body))
  const hex = Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const expected = `sha256=${hex}`
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}
