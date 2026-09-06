/**
 * EXT-03 — Extension lifecycle + invocation history.
 *
 * Read model over the authoritative `api.change_events` stream (via the
 * permission-aware `api.audit_events` RPC, owned by GOV-03): lifecycle
 * transitions are the `extension`-entity events for the install row
 * (create on install, update on enable/disable/update, delete on remove),
 * and invocation history is any canonical event whose payload carries the
 * extension audit identity (`extension_id`, stamped by callers that perform
 * durable extension-attributed writes — see `extensionInvocationAudit`).
 * The admin Extensions section renders both from this one source; nothing
 * here creates a second event system.
 */
import type { DataClient } from '../data-client'
import {
  fetchAuditEvents,
  type AuditEventWire,
} from '../audit-history'

export type ExtensionHistoryKind =
  | 'lifecycle'
  | 'invocation'
  | 'credential'
  | 'other'

export interface ExtensionHistoryEntry {
  event: AuditEventWire
  kind: ExtensionHistoryKind
}

/**
 * Fetch one page of history for an extension install, lifecycle first
 * (deterministic sequence-descending merge, deduped by event id). The RPC
 * enforces workspace membership; callers surface the permission error.
 */
export async function fetchExtensionHistory(
  client: DataClient,
  extensionId: string,
  limit = 50,
): Promise<ExtensionHistoryEntry[]> {
  const [lifecycle, attributed] = await Promise.all([
    fetchAuditEvents(client, {
      entityType: 'extension',
      object: extensionId,
      limit,
    }),
    fetchAuditEvents(client, { object: extensionId, limit }),
  ])
  const seen = new Set<string>()
  const merged: AuditEventWire[] = []
  for (const event of [...lifecycle.events, ...attributed.events]) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    merged.push(event)
  }
  merged.sort((a, b) => b.sequence - a.sequence)
  return merged
    .slice(0, limit)
    .map((event) => ({
      event,
      kind: classifyExtensionHistoryEvent(event, extensionId),
    }))
}

/** Classify one history event relative to an extension install. */
export function classifyExtensionHistoryEvent(
  event: AuditEventWire,
  extensionId: string,
): ExtensionHistoryKind {
  if (event.entityType === 'extension' && event.entityUuid === extensionId) {
    return 'lifecycle'
  }
  if (event.entityType === 'api_credential') return 'credential'
  const payload = event.payload ?? {}
  if (
    payload['extension_id'] === extensionId ||
    payload['extensionId'] === extensionId
  ) {
    return 'invocation'
  }
  return 'other'
}

/** Short human phrase for one history event; never fabricates values. */
export function describeExtensionHistoryEvent(
  entry: ExtensionHistoryEntry,
): string {
  const { event, kind } = entry
  if (kind === 'lifecycle') {
    switch (event.operation) {
      case 'create':
        return 'Installed'
      case 'delete':
        return 'Removed'
      case 'update':
        return 'Updated (enabled, disabled, or manifest change)'
      default:
        return `Lifecycle: ${event.operation}`
    }
  }
  if (kind === 'credential') {
    return event.operation === 'revoke'
      ? 'Extension credential revoked'
      : `Extension credential ${event.operation}`
  }
  if (kind === 'invocation') {
    return `Extension-attributed ${event.entityType} ${event.operation}`
  }
  return `${event.entityType} ${event.operation}`
}

export const extensionHistoryQueryKeys = {
  history: (extensionId: string) => ['extensions', extensionId, 'history'] as const,
}
