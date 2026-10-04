import { useQuery } from '@tanstack/react-query'

import { createDataClient } from '#/lib/data-client'
import type { ChangeEventRecordWire } from '#/lib/notebook-data'
import type { AuditEventWire } from '#/lib/audit-history'

/** UI port: shared access to `project_list_summary` for the Projects area.
 * The list and the detail layout/children all read the same cached query. */

export interface ProjectSummary {
  id: string
  key: string
  title: string
  status: string
  displayId: string | null
  clientId: string | null
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
  client_id: string | null
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
    clientId: row.client_id,
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

export interface ProjectActivityEvent extends AuditEventWire {
  currentActorName: string | null
  currentRecord: { id: string; identifier: string; title: string } | null
}

export async function fetchProjectActivity(
  projectId: string,
): Promise<ProjectActivityEvent[]> {
  const events = await projectDataClient.list<
    ChangeEventRecordWire & { sequence: string }
  >(
    'change_events',
    `?project_id=eq.${encodeURIComponent(projectId)}&order=sequence.desc&limit=3&select=id,sequence,entity_type,entity_uuid,operation,record_id,actor_user_id,payload,created_at`,
  )
  const recordIds = events
    .filter((event) => event.entity_type === 'record')
    .map((event) => event.entity_uuid)
  const [actors, records] = await Promise.all([
    events.some((event) => event.actor_user_id)
      ? fetchWorkspaceMemberIdentities()
      : Promise.resolve([]),
    recordIds.length
      ? projectDataClient.list<{
          id: string
          identifier: string
          title: string
        }>(
          'records',
          `?project_id=eq.${encodeURIComponent(projectId)}&id=in.(${recordIds.map(encodeURIComponent).join(',')})&select=id,identifier,title`,
        )
      : Promise.resolve([]),
  ])
  return events.map((event) => ({
    id: event.id,
    sequence: Number(event.sequence),
    entityType: event.entity_type,
    entityUuid: event.entity_uuid,
    operation: event.operation,
    recordId: event.record_id,
    projectId,
    actorUserId: event.actor_user_id,
    actorName: null,
    actorCredentialId: null,
    clientId: null,
    payload: event.payload,
    createdAt: event.created_at,
    currentActorName:
      actors.find((actor) => actor.user_id === event.actor_user_id)?.name ??
      null,
    currentRecord:
      records.find((record) => record.id === event.entity_uuid) ?? null,
  }))
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

export interface ProjectDetailsInput {
  title: string
  clientId: string | null
  modality: string | null
  stage: string | null
  leadUserId: string | null
  defaultReviewerUserId: string | null
  agreementReference: string | null
  startedOn: string | null
}

function projectDetailsArgs(input: ProjectDetailsInput) {
  return {
    p_title: input.title.trim(),
    p_client_id: input.clientId,
    p_modality: input.modality,
    p_stage: input.stage,
    p_lead_user_id: input.leadUserId,
    p_default_reviewer_user_id: input.defaultReviewerUserId,
    p_agreement_reference: input.agreementReference,
    p_started_on: input.startedOn,
  }
}

export function createProject(input: ProjectDetailsInput) {
  return projectDataClient.rpc<{ id: string; revision: string }>(
    'create_project',
    projectDetailsArgs(input),
  )
}

/** The canonical RPC replaces all properties, so always send a full snapshot. */
export function updateProjectDetails(
  project: Pick<ProjectSummary, 'id' | 'revision'>,
  input: ProjectDetailsInput,
) {
  return projectDataClient.rpc('update_project_details', {
    p_project_id: project.id,
    p_expected_revision: project.revision,
    ...projectDetailsArgs(input),
  })
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

// ---------------------------------------------------------------------------
// PROJ-02 — project milestones, reconciled with the study model
// (study_deliverables reached through the project's study tasks).
// ---------------------------------------------------------------------------

export interface ProjectMilestone {
  id: string
  name: string
  status: string
  dueAt: string | null
  linkedRecordId: string | null
  linkedRecordIdentifier: string | null
}

interface MilestoneWire {
  id: string
  name: string
  status: string
  due_at: string | null
  linked_record_id: string | null
  linked_record_identifier: string | null
}

export function useProjectMilestones(projectId: string) {
  return useQuery({
    queryKey: ['ui-port', 'project-milestones', projectId],
    enabled: projectId.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<ProjectMilestone[]> => {
      const tasks = await projectDataClient.list<{
        id: string
        task_type: string
        title: string
        status: string
        due_at: string | null
      }>(
        'study_tasks',
        `?project_id=eq.${encodeURIComponent(projectId)}&select=id,task_type,title,status,due_at&order=due_at.asc.nullslast,id.asc`,
      )
      if (tasks.length === 0) return []
      const ids = tasks.map((t) => t.id)
      const rows: MilestoneWire[] = []
      for (let i = 0; i < ids.length; i += 12) {
        const chunk = ids
          .slice(i, i + 12)
          .map((id) => encodeURIComponent(id))
          .join(',')
        const part = await projectDataClient.list<MilestoneWire>(
          'study_deliverables',
          `?task_id=in.(${chunk})&select=id,name,status,due_at,linked_record_id,linked_record_identifier&order=due_at.asc.nullslast,id.asc`,
        )
        rows.push(...part)
      }
      return [
        ...tasks
          .filter((task) => task.task_type === 'milestone')
          .map((task) => ({
            id: task.id,
            name: task.title,
            status:
              task.status === 'completed'
                ? 'delivered'
                : task.status === 'not_started'
                  ? 'planned'
                  : task.status,
            dueAt: task.due_at,
            linkedRecordId: null,
            linkedRecordIdentifier: null,
          })),
        ...rows.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          dueAt: r.due_at,
          linkedRecordId: r.linked_record_id,
          linkedRecordIdentifier: r.linked_record_identifier,
        })),
      ].sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
    },
  })
}
