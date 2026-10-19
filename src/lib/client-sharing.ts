import type { DataClient } from '#/lib/data-client'
import type {
  ClientPortalProject,
  ClientPortalRecord,
} from '#/lib/client-portal'

/**
 * Internal side of the client portal: create a client organisation, share an
 * individual approved record with it, and preview what its portal lists. The
 * database enforces who may do this (internal writers) and what may be shared
 * (approved records that belong to a project); the checks here only keep the
 * form from sending what it already knows will be refused.
 */
export interface ClientSummary {
  id: string
  code: string
  name: string
}

export interface ClientShare {
  id: string
  clientId: string
  recordId: string
  sharedAt: string
}

export interface ShareableRecord {
  id: string
  identifier: string
  title: string
  kind: string
}

export const clientSharingKeys = {
  clients: (workspaceId: string) =>
    ['client-sharing', workspaceId, 'clients'] as const,
  shares: (clientId: string) => ['client-sharing', 'shares', clientId] as const,
  shareable: (workspaceId: string) =>
    ['client-sharing', workspaceId, 'shareable'] as const,
  preview: (clientId: string) =>
    ['client-sharing', 'preview', clientId] as const,
}

/** A client's name, trimmed; null when it is not one the database accepts. */
export function validClientName(raw: string): string | null {
  const name = raw.trim()
  return name.length >= 1 && name.length <= 200 ? name : null
}

export async function fetchClientList(
  client: DataClient,
  workspaceId: string,
): Promise<ClientSummary[]> {
  return client.list<ClientSummary>(
    'clients',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&archived_at=is.null&select=id,code,name&order=code.asc`,
  )
}

export async function createClientOrganisation(
  client: DataClient,
  input: { workspaceId: string; name: string },
): Promise<ClientSummary> {
  const name = validClientName(input.name)
  if (!name) throw new Error('Enter a client name of up to 200 characters.')
  // The code (CL-001, …) is assigned by the database on insert.
  const row = await client.insert<ClientSummary | ClientSummary[]>('clients', {
    workspace_id: input.workspaceId,
    name,
  })
  const created = Array.isArray(row) ? row[0] : row
  return created
}

interface ShareWire {
  id: string
  client_id: string
  record_id: string
  shared_at: string
}

export async function fetchClientShares(
  client: DataClient,
  clientId: string,
): Promise<ClientShare[]> {
  const rows = await client.list<ShareWire>(
    'client_portal_shares',
    `?client_id=eq.${encodeURIComponent(clientId)}&select=id,client_id,record_id,shared_at&order=shared_at.desc`,
  )
  return rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    recordId: r.record_id,
    sharedAt: r.shared_at,
  }))
}

/** Approved records that belong to a project: the only ones that can be shared. */
export async function fetchShareableRecords(
  client: DataClient,
  workspaceId: string,
): Promise<ShareableRecord[]> {
  return client.list<ShareableRecord>(
    'records',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.approved&project_id=not.is.null&deleted_at=is.null&select=id,identifier,title,kind&order=identifier.asc&limit=500`,
  )
}

/** The records behind a client's shares, whatever their status is now. */
export async function fetchRecordsByIds(
  client: DataClient,
  ids: string[],
): Promise<Array<ShareableRecord & { status: string }>> {
  if (ids.length === 0) return []
  return client.list<ShareableRecord & { status: string }>(
    'records',
    `?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,identifier,title,kind,status`,
  )
}

/** Records still to offer for a client: approved and not already shared. */
export function unsharedRecords(
  records: ShareableRecord[],
  shares: ClientShare[],
): ShareableRecord[] {
  const shared = new Set(shares.map((s) => s.recordId))
  return records.filter((r) => !shared.has(r.id))
}

export async function shareRecordWithClient(
  client: DataClient,
  input: { clientId: string; recordId: string },
): Promise<void> {
  await client.rpc('share_record_with_client', {
    p_client_id: input.clientId,
    p_record_id: input.recordId,
  })
}

export async function unshareRecordWithClient(
  client: DataClient,
  input: { clientId: string; recordId: string },
): Promise<void> {
  await client.rpc('unshare_record_with_client', {
    p_client_id: input.clientId,
    p_record_id: input.recordId,
  })
}

interface PreviewRecordWire {
  record_id: string
  identifier: string
  title: string
  kind: string
  status: string
  project_id: string
  shared_at: string
  approved_at: string | null
  approved_by_name: string | null
}

interface PreviewProjectWire {
  project_id: string
  display_id: string | null
  title: string
  stage: string | null
  status: string
  modality: string | null
  lead_name: string | null
  last_update: string | null
  client_name: string
  client_code: string
}

export interface ClientPortalPreview {
  projects: ClientPortalProject[]
  records: ClientPortalRecord[]
}

/** What the client's portal lists for them, read by an internal writer. */
export async function fetchClientPortalPreview(
  client: DataClient,
  clientId: string,
): Promise<ClientPortalPreview> {
  const [projects, records] = await Promise.all([
    client.rpc<PreviewProjectWire[]>('client_portal_preview_projects', {
      p_client_id: clientId,
    }),
    client.rpc<PreviewRecordWire[]>('client_portal_preview_records', {
      p_client_id: clientId,
    }),
  ])
  return {
    projects: projects.map((r) => ({
      projectId: r.project_id,
      displayId: r.display_id,
      title: r.title,
      stage: r.stage,
      status: r.status,
      modality: r.modality,
      leadName: r.lead_name,
      lastUpdate: r.last_update,
      clientName: r.client_name,
      clientCode: r.client_code,
    })),
    records: records.map((r) => ({
      recordId: r.record_id,
      identifier: r.identifier,
      title: r.title,
      kind: r.kind,
      status: r.status,
      projectId: r.project_id,
      sharedAt: r.shared_at,
      approvedAt: r.approved_at,
      approvedByName: r.approved_by_name,
    })),
  }
}
