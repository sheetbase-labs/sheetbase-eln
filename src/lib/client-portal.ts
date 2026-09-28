import type { DataClient } from '#/lib/data-client'
import { createDataClient } from '#/lib/data-client'

/**
 * ADR-0049 — the client portal reads. Everything goes through the portal RPCs,
 * which are SECURITY DEFINER and scope to the caller's client; the client
 * viewer has no direct read access to records, blocks, projects or datasets.
 */
export interface ClientPortalProject {
  projectId: string
  displayId: string | null
  title: string
  stage: string | null
  clientName: string
  clientCode: string
}

export interface ClientPortalRecord {
  recordId: string
  identifier: string
  title: string
  kind: string
  status: string
  projectId: string
  sharedAt: string
}

interface ProjectWire {
  project_id: string
  display_id: string | null
  title: string
  stage: string | null
  client_name: string
  client_code: string
}

interface RecordWire {
  record_id: string
  identifier: string
  title: string
  kind: string
  status: string
  project_id: string
  shared_at: string
}

export const clientPortalDataClient = createDataClient()

export const clientPortalQueryKeys = {
  projects: ['ui-port', 'client-portal', 'projects'] as const,
  records: ['ui-port', 'client-portal', 'records'] as const,
}

export async function fetchClientPortalProjects(
  client: DataClient = clientPortalDataClient,
): Promise<ClientPortalProject[]> {
  const rows = await client.rpc<ProjectWire[]>('client_portal_projects', {})
  return rows.map((r) => ({
    projectId: r.project_id,
    displayId: r.display_id,
    title: r.title,
    stage: r.stage,
    clientName: r.client_name,
    clientCode: r.client_code,
  }))
}

export async function fetchClientPortalRecords(
  client: DataClient = clientPortalDataClient,
): Promise<ClientPortalRecord[]> {
  const rows = await client.rpc<RecordWire[]>('client_portal_records', {})
  return rows.map((r) => ({
    recordId: r.record_id,
    identifier: r.identifier,
    title: r.title,
    kind: r.kind,
    status: r.status,
    projectId: r.project_id,
    sharedAt: r.shared_at,
  }))
}
