/**
 * SET-01.1 — workspace general settings.
 */
import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'

export interface WorkspaceGeneral {
  name: string | null
  site: string | null
  timezone: string
  dateFormat: string
  numberFormat: 'decimal' | 'scientific'
  publicationApprovalRequired: boolean
  /** SET-01.2 — identifier prefix per record kind. */
  idPrefixes: Record<string, string>
}

/** Record kinds whose identifier prefix the workspace can configure. */
export const ID_PREFIX_KINDS = [
  'experiment',
  'sample',
  'dataset',
  'protocol_template',
  'reagent',
  'report',
  'file',
  'notebook_template',
] as const

interface WorkspaceSettingsWire {
  site: string | null
  timezone: string
  date_format: string
  number_format: string
  publication_approval_required: boolean
  id_prefixes: Record<string, string> | null
  workspaces: { name: string } | null
}

export const workspaceGeneralQueryKey = ['workspace-general'] as const

export const DATE_FORMATS = [
  { value: 'd MMM yyyy', label: '25 Sep 2026' },
  { value: 'dd/MM/yyyy', label: '25/09/2026' },
  { value: 'yyyy-MM-dd', label: '2026-09-25' },
] as const

export const NUMBER_FORMATS = [
  { value: 'decimal', label: 'Decimal (1,234.5)' },
  { value: 'scientific', label: 'Scientific (1.23×10³)' },
] as const

export async function fetchWorkspaceGeneral(
  client: DataClient = notebookDataClient,
): Promise<WorkspaceGeneral | null> {
  const rows = await client.list<WorkspaceSettingsWire>(
    'workspace_settings',
    '?select=site,timezone,date_format,number_format,publication_approval_required,id_prefixes,workspaces(name)&limit=1',
  )
  if (rows.length === 0) return null
  const row = rows[0]
  return {
    name: row.workspaces?.name ?? null,
    site: row.site,
    timezone: row.timezone,
    dateFormat: row.date_format,
    numberFormat: row.number_format === 'scientific' ? 'scientific' : 'decimal',
    publicationApprovalRequired: row.publication_approval_required,
    idPrefixes: row.id_prefixes ?? {},
  }
}

export async function updateWorkspaceGeneral(
  workspaceId: string,
  input: WorkspaceGeneral,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('update_workspace_general', {
    p_workspace_id: workspaceId,
    p_site: input.site,
    p_timezone: input.timezone,
    p_date_format: input.dateFormat,
    p_number_format: input.numberFormat,
  })
}

export async function updateWorkspacePublicationPolicy(
  workspaceId: string,
  required: boolean,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('update_workspace_publication_policy', {
    p_workspace_id: workspaceId,
    p_required: required,
  })
}

/** SET-01.1 — rename the workspace (admin only). */
export async function updateWorkspaceName(
  workspaceId: string,
  name: string,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('update_workspace_name', {
    p_workspace_id: workspaceId,
    p_name: name,
  })
}

export async function updateWorkspaceIdPrefixes(
  workspaceId: string,
  prefixes: Record<string, string>,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('update_workspace_id_prefixes', {
    p_workspace_id: workspaceId,
    p_prefixes: prefixes,
  })
}
