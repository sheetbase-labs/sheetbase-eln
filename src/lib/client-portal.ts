import type { DataClient } from '#/lib/data-client'
import { createDataClient } from '#/lib/data-client'
import type { SignatureMeaning } from '#/lib/signatures'

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
  status: string
  modality: string | null
  leadName: string | null
  lastUpdate: string | null
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
  approvedAt: string | null
  approvedByName: string | null
}

export interface ClientPortalMilestone {
  milestoneId: string
  title: string
  status: string
  dueAt: string | null
}

export interface ClientPortalReport {
  recordId: string
  identifier: string
  title: string
  covers: string | null
  sharedAt: string
}

/**
 * The approved record document the PDF byte route renders. `blockSnapshot` is
 * the signed revision's frozen blocks; `reportSections` the frozen sections of
 * a report. `verificationCode` is the short form of the signed revision's
 * integrity digest a client checks against the CDMO audit trail.
 */
export interface ClientPortalRecordDocument {
  recordId: string
  identifier: string
  title: string
  kind: string
  projectTitle: string
  approvedAt: string | null
  approvedByName: string | null
  signatureMeaning: string | null
  integrityDigest: string | null
  verificationCode: string | null
  revisionStructureVersion: number | null
  revisionId?: string | null
  blockSnapshot: unknown
  scientificTables?: unknown
  sheetEvidence?: unknown
  /** Immutable evidence from the selected revision, never today's profiles. */
  signatures?: ReadonlyArray<{
    id: string
    revisionId: string
    signerName: string | null
    signedAt: string
    signatureMeaning: SignatureMeaning
    integrityDigest: string
  }>
  reportSections: ReadonlyArray<{
    title: string
    description: string | null
    payload: unknown
  }>
}

interface ProjectWire {
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

interface RecordWire {
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

interface MilestoneWire {
  milestone_id: string
  title: string
  status: string
  due_at: string | null
}

interface ReportWire {
  record_id: string
  identifier: string
  title: string
  covers: string | null
  shared_at: string
}

export const clientPortalDataClient = createDataClient()

export interface ClientPortalMessage {
  id: string
  clientId: string
  projectId: string | null
  authorKind: 'team' | 'client'
  authorUserId: string
  authorName: string | null
  body: string
  createdAt: string
}

interface MessageWire {
  id: string
  client_id: string
  project_id: string | null
  author_kind: 'team' | 'client'
  author_user_id: string
  author_name: string | null
  body: string
  created_at: string
}

export interface ClientPortalIdentity {
  clientId: string
  clientName: string
  clientCode: string
}

export const clientPortalQueryKeys = {
  identity: ['ui-port', 'client-portal', 'identity'] as const,
  projects: ['ui-port', 'client-portal', 'projects'] as const,
  records: ['ui-port', 'client-portal', 'records'] as const,
  reports: ['ui-port', 'client-portal', 'reports'] as const,
  messages: ['ui-port', 'client-portal', 'messages'] as const,
  milestones: (projectId: string) =>
    ['ui-port', 'client-portal', 'milestones', projectId] as const,
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** Absolute short day the portal shows for messages: "25 Sep". */
export function formatPortalDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return '—'
  const date = new Date(parsed)
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`
}

/** Relative calendar date the portal shows: "Today" or "20 Sep". */
export function formatPortalDate(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return '—'
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return '—'
  const date = new Date(parsed)
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return 'Today'
  }
  return formatPortalDay(iso)
}

export async function fetchClientPortalIdentity(
  client: DataClient = clientPortalDataClient,
): Promise<ClientPortalIdentity | null> {
  return client.rpc<ClientPortalIdentity | null>('client_portal_identity', {})
}

export async function fetchClientPortalMessages(
  client: DataClient = clientPortalDataClient,
): Promise<ClientPortalMessage[]> {
  const rows = await client.rpc<MessageWire[]>('client_portal_messages', {
    p_client_id: null,
  })
  return rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    projectId: r.project_id,
    authorKind: r.author_kind,
    authorUserId: r.author_user_id,
    authorName: r.author_name,
    body: r.body,
    createdAt: r.created_at,
  }))
}

export async function postClientPortalMessage(
  body: string,
  projectId: string | null = null,
  client: DataClient = clientPortalDataClient,
): Promise<void> {
  await client.rpc('post_client_portal_message', {
    p_client_id: null,
    p_project_id: projectId,
    p_body: body,
  })
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
    status: r.status,
    modality: r.modality,
    leadName: r.lead_name,
    lastUpdate: r.last_update,
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
    approvedAt: r.approved_at,
    approvedByName: r.approved_by_name,
  }))
}

export async function fetchClientPortalMilestones(
  projectId: string,
  client: DataClient = clientPortalDataClient,
): Promise<ClientPortalMilestone[]> {
  const rows = await client.rpc<MilestoneWire[]>('client_portal_milestones', {
    p_project_id: projectId,
  })
  return rows.map((r) => ({
    milestoneId: r.milestone_id,
    title: r.title,
    status: r.status,
    dueAt: r.due_at,
  }))
}

export async function fetchClientPortalReports(
  client: DataClient = clientPortalDataClient,
): Promise<ClientPortalReport[]> {
  const rows = await client.rpc<ReportWire[]>('client_portal_reports', {})
  return rows.map((r) => ({
    recordId: r.record_id,
    identifier: r.identifier,
    title: r.title,
    covers: r.covers,
    sharedAt: r.shared_at,
  }))
}
