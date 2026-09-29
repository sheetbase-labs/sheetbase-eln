import { useQuery } from '@tanstack/react-query'

import { createDataClient } from '#/lib/data-client'

/** UI port: shared access to `project_list_summary` for the Projects area.
 * The list and the detail layout/children all read the same cached query. */

export interface ProjectSummary {
  id: string
  key: string
  title: string
  status: string
  displayId: string | null
  clientCode: string | null
  clientName: string | null
  modality: string | null
  stage: string | null
  leadUserId: string | null
  leadName: string | null
  defaultReviewerUserId: string | null
  agreementReference: string | null
  startedOn: string | null
  revision: string
  archivedAt: string | null
  updatedAt: string
  experimentCount: number
}

interface SummaryWire {
  id: string
  key: string
  title: string
  status: string
  display_id: string | null
  client_code: string | null
  client_name: string | null
  modality: string | null
  stage: string | null
  lead_user_id: string | null
  lead_name: string | null
  default_reviewer_user_id: string | null
  agreement_reference: string | null
  started_on: string | null
  revision: string
  archived_at: string | null
  updated_at: string
  experiment_count?: number
}

export const projectDataClient = createDataClient()
export const PROJECTS_KEY = ['projects'] as const

export function toProjectSummary(row: SummaryWire): ProjectSummary {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    status: row.status,
    displayId: row.display_id,
    clientCode: row.client_code,
    clientName: row.client_name,
    modality: row.modality,
    stage: row.stage,
    leadUserId: row.lead_user_id,
    leadName: row.lead_name,
    defaultReviewerUserId: row.default_reviewer_user_id,
    agreementReference: row.agreement_reference,
    startedOn: row.started_on,
    revision: row.revision,
    archivedAt: row.archived_at,
    updatedAt: row.updated_at,
    experimentCount: Number(row.experiment_count ?? 0),
  }
}

export async function fetchProjectSummaries(
  workspaceId: string | undefined,
): Promise<ProjectSummary[]> {
  const rows: SummaryWire[] = []
  for (;;) {
    const page = await projectDataClient.list<SummaryWire>(
      'rpc/project_list_summary',
      `?order=updated_at.desc,id.asc&limit=200&offset=${rows.length}`,
    )
    rows.push(...page)
    if (page.length < 200) break
  }
  void workspaceId
  return rows.map(toProjectSummary)
}

export function useProjectSummary(projectId: string) {
  const query = useQuery({
    queryKey: [...PROJECTS_KEY, 'summary'],
    queryFn: () => fetchProjectSummaries(undefined),
  })
  const project = query.data?.find((p) => p.id === projectId) ?? null
  return { project, query }
}

export interface ProjectMember {
  user_id: string
  name: string
  access_level: string
  workspace_role: string | null
  is_lead: boolean
  added_at: string
}

export interface WorkspaceMemberIdentity {
  user_id: string
  name: string
  role: string
}

export async function fetchProjectMembers(
  projectId: string,
): Promise<ProjectMember[]> {
  return projectDataClient.rpc<ProjectMember[]>('project_members', {
    p_project_id: projectId,
  })
}

export async function fetchWorkspaceMemberIdentities(): Promise<
  WorkspaceMemberIdentity[]
> {
  return projectDataClient.rpc<WorkspaceMemberIdentity[]>(
    'workspace_members_list',
    {},
  )
}

export const workspaceMemberQueryKeys = {
  identities: ['ui-port', 'workspace-members'] as const,
}

/** Workspace member display names, keyed by user id. Shared by screens that
 * name the person behind a record (schedule bookers, model/template owners). */
export function useWorkspaceMemberNames() {
  return useQuery({
    queryKey: workspaceMemberQueryKeys.identities,
    queryFn: async () => {
      const members = await fetchWorkspaceMemberIdentities()
      return new Map(members.map((m) => [m.user_id, m.name]))
    },
    staleTime: 60_000,
  })
}

export async function setProjectMember(
  projectId: string,
  userId: string,
  accessLevel: string,
): Promise<void> {
  await projectDataClient.rpc('set_project_member', {
    p_project_id: projectId,
    p_user_id: userId,
    p_access_level: accessLevel,
  })
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<void> {
  await projectDataClient.rpc('remove_project_member', {
    p_project_id: projectId,
    p_user_id: userId,
  })
}

export interface ProjectFolder {
  id: string
  project_id: string
  parent_id: string | null
  identifier: string
  name: string
}

export async function fetchProjectFolders(
  projectId: string,
): Promise<ProjectFolder[]> {
  return projectDataClient.list<ProjectFolder>(
    'folders',
    `?project_id=eq.${projectId}&archived_at=is.null&order=name.asc&select=id,project_id,parent_id,identifier,name`,
  )
}

export async function createProjectFolder(
  projectId: string,
  name: string,
  parentId: string | null,
): Promise<ProjectFolder> {
  return projectDataClient.rpc<ProjectFolder>('create_project_folder', {
    p_project_id: projectId,
    p_name: name,
    p_parent_id: parentId,
  })
}

export async function moveRecordsToFolder(
  projectId: string,
  recordIds: string[],
  folderId: string | null,
): Promise<number> {
  return projectDataClient.rpc<number>('move_records_to_folder', {
    p_project_id: projectId,
    p_record_ids: recordIds,
    p_folder_id: folderId,
  })
}
