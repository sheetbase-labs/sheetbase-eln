/**
 * OPS-005 — Study Planner domain model and persistence boundary.
 *
 * Wire mappers, typed wrappers around the study planner RPCs (migration 0051),
 * and timeline navigation helpers. PostgreSQL and RLS remain the
 * authoritative access-control boundary; these helpers drive the UI,
 * normalise wire shapes and map RPC error codes to actionable messages.
 */
import type { DataClient } from './data-client'
import { DataClientError } from './data-client'

// ---------------------------------------------------------------------------
// Wire shapes (PostgREST snake_case).
// ---------------------------------------------------------------------------

export type StudyTaskType = 'task' | 'milestone'
export type StudyTaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'review'
  | 'completed'
  | 'blocked'
  | 'cancelled'
export type StudyTaskPriority = 'low' | 'medium' | 'high' | 'critical'
export type StudyApprovalStatus =
  'not_required' | 'pending' | 'approved' | 'rejected'
export type StudyAssignmentRole = 'assignee' | 'reviewer' | 'observer'
export type StudyDependencyType =
  'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish'
export type StudyDeliverableStatus =
  'planned' | 'in_progress' | 'delivered' | 'overdue'
export type StudyWorkstreamStatus = 'active' | 'archived'
export type PlannerView =
  'timeline' | 'list' | 'workload'

export interface StudyWorkstreamWire {
  id: string
  workspace_id: string
  project_id: string | null
  name: string
  color: string | null
  position: number
  status: StudyWorkstreamStatus
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
}

export interface StudyTaskWire {
  id: string
  workspace_id: string
  workstream_id: string | null
  project_id: string | null
  title: string
  description: string | null
  task_type: StudyTaskType
  status: StudyTaskStatus
  priority: StudyTaskPriority
  starts_at: string | null
  ends_at: string | null
  due_at: string | null
  timezone: string
  position: number
  color: string | null
  progress_percent: number
  linked_experiment_record_id: string | null
  linked_experiment_identifier: string | null
  linked_experiment_title: string | null
  linked_protocol_record_id: string | null
  linked_protocol_identifier: string | null
  approval_required: boolean
  approval_status: StudyApprovalStatus
  tags: string[]
  metadata_version: number
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
}

export interface StudyTaskDependencyWire {
  id: string
  workspace_id: string
  predecessor_id: string
  successor_id: string
  dependency_type: StudyDependencyType
  lag_days: number
  is_external: boolean
  created_at: string
  created_by_user_id: string | null
}

export interface StudyTaskAssignmentWire {
  id: string
  workspace_id: string
  task_id: string
  user_id: string | null
  display_name: string | null
  role: StudyAssignmentRole
  effort_percent: number
  created_at: string
}

export interface StudyTaskResourceWire {
  id: string
  workspace_id: string
  task_id: string
  calendar_resource_id: string
  starts_at: string
  ends_at: string
  notes: string | null
  created_at: string
  created_by_user_id: string | null
}

export interface StudyDeliverableWire {
  id: string
  workspace_id: string
  task_id: string
  name: string
  description: string | null
  status: StudyDeliverableStatus
  due_at: string | null
  linked_record_id: string | null
  linked_record_identifier: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Domain types (camelCase, used by the UI).
// ---------------------------------------------------------------------------

export interface StudyWorkstream {
  id: string
  workspaceId: string
  projectId: string | null
  name: string
  color: string | null
  position: number
  status: StudyWorkstreamStatus
  createdAt: string
  updatedAt: string
}

export interface StudyTaskAssignment {
  id: string
  taskId: string
  userId: string | null
  displayName: string | null
  role: StudyAssignmentRole
  effortPercent: number
  createdAt: string
}

export interface StudyTaskResource {
  id: string
  taskId: string
  calendarResourceId: string
  startsAt: string
  endsAt: string
  notes: string | null
  createdAt: string
}

export interface StudyDeliverable {
  id: string
  taskId: string
  name: string
  description: string | null
  status: StudyDeliverableStatus
  dueAt: string | null
  linkedRecordId: string | null
  linkedRecordIdentifier: string | null
  createdAt: string
  updatedAt: string
}

export interface StudyTaskDependency {
  id: string
  predecessorId: string
  successorId: string
  dependencyType: StudyDependencyType
  lagDays: number
  isExternal: boolean
  createdAt: string
}

export interface StudyTask {
  id: string
  workspaceId: string
  workstreamId: string | null
  projectId: string | null
  title: string
  description: string | null
  taskType: StudyTaskType
  status: StudyTaskStatus
  priority: StudyTaskPriority
  startsAt: string | null
  endsAt: string | null
  dueAt: string | null
  timezone: string
  position: number
  color: string | null
  progressPercent: number
  linkedExperimentRecordId: string | null
  linkedExperimentIdentifier: string | null
  linkedExperimentTitle: string | null
  linkedProtocolRecordId: string | null
  linkedProtocolIdentifier: string | null
  approvalRequired: boolean
  approvalStatus: StudyApprovalStatus
  tags: string[]
  metadataVersion: number
  createdAt: string
  updatedAt: string
  assignments: StudyTaskAssignment[]
  resources: StudyTaskResource[]
  deliverables: StudyDeliverable[]
}

export interface StudyTaskInput {
  title: string
  taskType?: StudyTaskType
  workstreamId?: string | null
  projectId?: string | null
  description?: string | null
  status?: StudyTaskStatus
  priority?: StudyTaskPriority
  startsAt?: string | null
  endsAt?: string | null
  dueAt?: string | null
  timezone?: string
  position?: number
  color?: string | null
  progressPercent?: number
  linkedExperimentRecordId?: string | null
  linkedProtocolRecordId?: string | null
  approvalRequired?: boolean
  tags?: string[]
  assignments?: Array<{
    userId?: string | null
    displayName?: string | null
    role?: StudyAssignmentRole
    effortPercent?: number
  }>
  resources?: Array<{
    calendarResourceId: string
    startsAt: string
    endsAt: string
    notes?: string | null
  }>
}

// ---------------------------------------------------------------------------
// Wire → domain mappers.
// ---------------------------------------------------------------------------

export function toStudyWorkstream(wire: StudyWorkstreamWire): StudyWorkstream {
  return {
    id: wire.id,
    workspaceId: wire.workspace_id,
    projectId: wire.project_id,
    name: wire.name,
    color: wire.color,
    position: wire.position,
    status: wire.status,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  }
}

export function toStudyTaskAssignment(
  wire: StudyTaskAssignmentWire,
): StudyTaskAssignment {
  return {
    id: wire.id,
    taskId: wire.task_id,
    userId: wire.user_id,
    displayName: wire.display_name,
    role: wire.role,
    effortPercent: wire.effort_percent,
    createdAt: wire.created_at,
  }
}

export function toStudyTaskResource(
  wire: StudyTaskResourceWire,
): StudyTaskResource {
  return {
    id: wire.id,
    taskId: wire.task_id,
    calendarResourceId: wire.calendar_resource_id,
    startsAt: wire.starts_at,
    endsAt: wire.ends_at,
    notes: wire.notes,
    createdAt: wire.created_at,
  }
}

export function toStudyDeliverable(
  wire: StudyDeliverableWire,
): StudyDeliverable {
  return {
    id: wire.id,
    taskId: wire.task_id,
    name: wire.name,
    description: wire.description,
    status: wire.status,
    dueAt: wire.due_at,
    linkedRecordId: wire.linked_record_id,
    linkedRecordIdentifier: wire.linked_record_identifier,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  }
}

export function toStudyTaskDependency(
  wire: StudyTaskDependencyWire,
): StudyTaskDependency {
  return {
    id: wire.id,
    predecessorId: wire.predecessor_id,
    successorId: wire.successor_id,
    dependencyType: wire.dependency_type,
    lagDays: wire.lag_days,
    isExternal: wire.is_external,
    createdAt: wire.created_at,
  }
}

export function toStudyTask(
  task: StudyTaskWire,
  assignments: StudyTaskAssignmentWire[] = [],
  resources: StudyTaskResourceWire[] = [],
  deliverables: StudyDeliverableWire[] = [],
): StudyTask {
  return {
    id: task.id,
    workspaceId: task.workspace_id,
    workstreamId: task.workstream_id,
    projectId: task.project_id,
    title: task.title,
    description: task.description,
    taskType: task.task_type,
    status: task.status,
    priority: task.priority,
    startsAt: task.starts_at,
    endsAt: task.ends_at,
    dueAt: task.due_at,
    timezone: task.timezone,
    position: task.position,
    color: task.color,
    progressPercent: task.progress_percent,
    linkedExperimentRecordId: task.linked_experiment_record_id,
    linkedExperimentIdentifier: task.linked_experiment_identifier,
    linkedExperimentTitle: task.linked_experiment_title,
    linkedProtocolRecordId: task.linked_protocol_record_id,
    linkedProtocolIdentifier: task.linked_protocol_identifier,
    approvalRequired: task.approval_required,
    approvalStatus: task.approval_status,
    tags: task.tags,
    metadataVersion: task.metadata_version,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    assignments: assignments.map(toStudyTaskAssignment),
    resources: resources.map(toStudyTaskResource),
    deliverables: deliverables.map(toStudyDeliverable),
  }
}

// ---------------------------------------------------------------------------
// Query keys.
// ---------------------------------------------------------------------------

export const plannerQueryKeys = {
  workstreams: (workspaceId: string) =>
    ['ops-005', 'workstreams', workspaceId] as const,
  tasks: (workspaceId: string) => ['ops-005', 'tasks', workspaceId] as const,
  taskDetail: (taskId: string) => ['ops-005', 'task-detail', taskId] as const,
  assignments: (taskId: string) => ['ops-005', 'assignments', taskId] as const,
  resources: (taskId: string) => ['ops-005', 'resources', taskId] as const,
  deliverables: (taskId: string) =>
    ['ops-005', 'deliverables', taskId] as const,
  dependencies: (workspaceId: string) =>
    ['ops-005', 'dependencies', workspaceId] as const,
}

// ---------------------------------------------------------------------------
// Data fetchers.
// ---------------------------------------------------------------------------

export async function fetchStudyWorkstreams(
  client: DataClient,
  workspaceId: string,
): Promise<StudyWorkstream[]> {
  const rows = await client.list<StudyWorkstreamWire>(
    'study_workstreams',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=position,name`,
  )
  return rows.map(toStudyWorkstream)
}

export async function fetchStudyTasks(
  client: DataClient,
  workspaceId: string,
): Promise<StudyTaskWire[]> {
  return client.list<StudyTaskWire>(
    'study_tasks',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=position,title`,
  )
}

export async function fetchStudyTaskAssignments(
  client: DataClient,
  taskId: string,
): Promise<StudyTaskAssignment[]> {
  const rows = await client.list<StudyTaskAssignmentWire>(
    'study_task_assignments',
    `?task_id=eq.${encodeURIComponent(taskId)}&order=role,created_at`,
  )
  return rows.map(toStudyTaskAssignment)
}

export async function fetchStudyTaskResources(
  client: DataClient,
  taskId: string,
): Promise<StudyTaskResource[]> {
  const rows = await client.list<StudyTaskResourceWire>(
    'study_task_resources',
    `?task_id=eq.${encodeURIComponent(taskId)}&order=starts_at`,
  )
  return rows.map(toStudyTaskResource)
}

export async function fetchStudyDeliverables(
  client: DataClient,
  taskId: string,
): Promise<StudyDeliverable[]> {
  const rows = await client.list<StudyDeliverableWire>(
    'study_deliverables',
    `?task_id=eq.${encodeURIComponent(taskId)}&order=due_at,name`,
  )
  return rows.map(toStudyDeliverable)
}

export async function fetchStudyDependencies(
  client: DataClient,
  workspaceId: string,
): Promise<StudyTaskDependency[]> {
  const rows = await client.list<StudyTaskDependencyWire>(
    'study_task_dependencies',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}`,
  )
  return rows.map(toStudyTaskDependency)
}

/** Fetch all study task resources for a workspace (for conflict detection). */
export async function fetchCalendarResourcesAsPlanner(
  client: DataClient,
  workspaceId: string,
): Promise<StudyTaskResource[]> {
  const rows = await client.list<StudyTaskResourceWire>(
    'study_task_resources',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=starts_at`,
  )
  return rows.map(toStudyTaskResource)
}

// ---------------------------------------------------------------------------
// RPC wrappers.
// ---------------------------------------------------------------------------

export async function createStudyWorkstream(
  client: DataClient,
  input: {
    workspaceId: string
    name: string
    projectId?: string | null
    color?: string | null
    position?: number
  },
): Promise<StudyWorkstream> {
  const wire = await client.rpc<StudyWorkstreamWire>(
    'create_study_workstream',
    {
      p_workspace_id: input.workspaceId,
      p_name: input.name,
      p_project_id: input.projectId ?? null,
      p_color: input.color ?? null,
      p_position: input.position ?? 0,
    },
  )
  return toStudyWorkstream(wire)
}

function serializeAssignments(assignments: StudyTaskInput['assignments'] = []) {
  return assignments.map((a) => ({
    userId: a.userId ?? null,
    displayName: a.displayName ?? null,
    role: a.role ?? 'assignee',
    effortPercent: a.effortPercent ?? 100,
  }))
}

function serializeTaskResources(resources: StudyTaskInput['resources'] = []) {
  return resources.map((r) => ({
    calendarResourceId: r.calendarResourceId,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    notes: r.notes ?? null,
  }))
}

export async function createStudyTask(
  client: DataClient,
  workspaceId: string,
  input: StudyTaskInput,
): Promise<StudyTaskWire> {
  return client.rpc('create_study_task', {
    p_workspace_id: workspaceId,
    p_title: input.title,
    p_task_type: input.taskType ?? 'task',
    p_workstream_id: input.workstreamId ?? null,
    p_project_id: input.projectId ?? null,
    p_description: input.description ?? null,
    p_status: input.status ?? 'not_started',
    p_priority: input.priority ?? 'medium',
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
    p_due_at: input.dueAt ?? null,
    p_timezone: input.timezone ?? 'UTC',
    p_position: input.position ?? 0,
    p_color: input.color ?? null,
    p_progress_percent: input.progressPercent ?? 0,
    p_linked_experiment_record_id: input.linkedExperimentRecordId ?? null,
    p_linked_protocol_record_id: input.linkedProtocolRecordId ?? null,
    p_approval_required: input.approvalRequired ?? false,
    p_tags: input.tags ?? [],
    p_assignments: serializeAssignments(input.assignments),
    p_resources: serializeTaskResources(input.resources),
  })
}

export async function editStudyTask(
  client: DataClient,
  input: {
    taskId: string
    title?: string
    description?: string | null
    taskType?: StudyTaskType
    status?: StudyTaskStatus
    priority?: StudyTaskPriority
    startsAt?: string | null
    endsAt?: string | null
    dueAt?: string | null
    timezone?: string
    workstreamId?: string | null
    projectId?: string | null
    position?: number
    color?: string | null
    progressPercent?: number
    linkedExperimentRecordId?: string | null
    linkedProtocolRecordId?: string | null
    approvalRequired?: boolean
    approvalStatus?: StudyApprovalStatus
    tags?: string[]
    expectedMetadataVersion?: number
  },
): Promise<StudyTaskWire> {
  return client.rpc('edit_study_task', {
    p_task_id: input.taskId,
    p_title: input.title ?? null,
    p_description: input.description ?? null,
    p_task_type: input.taskType ?? null,
    p_status: input.status ?? null,
    p_priority: input.priority ?? null,
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
    p_due_at: input.dueAt ?? null,
    p_timezone: input.timezone ?? null,
    p_workstream_id: input.workstreamId ?? null,
    p_project_id: input.projectId ?? null,
    p_position: input.position ?? null,
    p_color: input.color ?? null,
    p_progress_percent: input.progressPercent ?? null,
    p_linked_experiment_record_id: input.linkedExperimentRecordId ?? null,
    p_linked_protocol_record_id: input.linkedProtocolRecordId ?? null,
    p_approval_required: input.approvalRequired ?? null,
    p_approval_status: input.approvalStatus ?? null,
    p_tags: input.tags ?? null,
    p_expected_metadata_version: input.expectedMetadataVersion ?? null,
  })
}

export async function deleteStudyTask(
  client: DataClient,
  taskId: string,
): Promise<void> {
  await client.rpc('delete_study_task', { p_task_id: taskId })
}

export async function createDependency(
  client: DataClient,
  input: {
    workspaceId: string
    predecessorId: string
    successorId: string
    dependencyType?: StudyDependencyType
    lagDays?: number
    isExternal?: boolean
  },
): Promise<StudyTaskDependencyWire> {
  return client.rpc('create_dependency', {
    p_workspace_id: input.workspaceId,
    p_predecessor_id: input.predecessorId,
    p_successor_id: input.successorId,
    p_dependency_type: input.dependencyType ?? 'finish_to_start',
    p_lag_days: input.lagDays ?? 0,
    p_is_external: input.isExternal ?? false,
  })
}

export async function deleteDependency(
  client: DataClient,
  dependencyId: string,
): Promise<void> {
  await client.rpc('delete_dependency', { p_dependency_id: dependencyId })
}

export async function assignTaskResource(
  client: DataClient,
  input: {
    workspaceId: string
    taskId: string
    calendarResourceId: string
    startsAt: string
    endsAt: string
    notes?: string | null
  },
): Promise<StudyTaskResourceWire> {
  return client.rpc('assign_task_resource', {
    p_workspace_id: input.workspaceId,
    p_task_id: input.taskId,
    p_calendar_resource_id: input.calendarResourceId,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_notes: input.notes ?? null,
  })
}

// ---------------------------------------------------------------------------
// Error mapping.
// ---------------------------------------------------------------------------

export function describePlannerError(error: unknown): string {
  if (!(error instanceof DataClientError))
    return 'Could not complete the planner operation. Try again.'
  const messages: Record<string, string> = {
    SB001: 'This task was edited by someone else. Refresh and try again.',
    SB005: 'The task input is invalid. Check the details and try again.',
    SB016: 'The selected item belongs to a different workspace.',
    SB021: 'The resource was not found in this workspace.',
    SB026: 'The task was not found in this workspace.',
    SB027: 'The workstream was not found in this workspace.',
    SB028: 'The dependency was not found in this workspace.',
    SB029: 'This dependency would create a circular dependency.',
    SB030: 'This resource is overbooked in the requested time range.',
    SB031: 'A task cannot depend on itself.',
    SB032: 'The end time must be after the start time.',
    '42501': 'You do not have access to this study planner.',
  }
  return messages[error.code] ?? error.message
}

// ---------------------------------------------------------------------------
// Status styling tokens (matches the mockup palette).
// ---------------------------------------------------------------------------

export const TASK_STATUS_TOKENS: Record<StudyTaskStatus, string> = {
  not_started: 'bg-muted text-muted-foreground border-border',
  in_progress: 'bg-blue-100 text-blue-900 border-blue-300',
  review: 'bg-amber-100 text-amber-900 border-amber-300',
  completed: 'bg-green-100 text-green-900 border-green-300',
  blocked: 'bg-red-100 text-red-900 border-red-300',
  cancelled: 'bg-muted text-muted-foreground border-border line-through',
}

/**
 * Maps task statuses to `Badge` variants so status pills use the shared
 * semantic tokens (UI-005) instead of one-off className combinations.
 */
export const TASK_STATUS_BADGE_VARIANT: Record<
  StudyTaskStatus,
  'outline' | 'info' | 'success' | 'warning' | 'danger'
> = {
  not_started: 'outline',
  in_progress: 'info',
  review: 'warning',
  completed: 'success',
  blocked: 'danger',
  cancelled: 'outline',
}

export const TASK_STATUS_LABELS: Record<StudyTaskStatus, string> = {
  not_started: 'Todo',
  in_progress: 'In progress',
  review: 'Review',
  completed: 'Done',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
}

export const PRIORITY_LABELS: Record<StudyTaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export const PRIORITY_TOKENS: Record<StudyTaskPriority, string> = {
  low: 'text-muted-foreground',
  medium: 'text-blue-600',
  high: 'text-amber-600',
  critical: 'text-red-600',
}

// ---------------------------------------------------------------------------
// Timeline helpers.
// ---------------------------------------------------------------------------

/** The date to use for positioning a task on the timeline. */
export function taskStartDate(task: StudyTaskWire | StudyTask): Date {
  const isMilestone =
    'task_type' in task
      ? task.task_type === 'milestone'
      : task.taskType === 'milestone'
  if (isMilestone) {
    const due = 'due_at' in task ? task.due_at : task.dueAt
    const starts = 'starts_at' in task ? task.starts_at : task.startsAt
    return new Date(due ?? starts ?? Date.now())
  }
  const starts = 'starts_at' in task ? task.starts_at : task.startsAt
  return new Date(starts ?? Date.now())
}

/** The end date for positioning a task bar. */
export function taskEndDate(task: StudyTaskWire | StudyTask): Date {
  const isMilestone =
    'task_type' in task
      ? task.task_type === 'milestone'
      : task.taskType === 'milestone'
  if (isMilestone) {
    const due = 'due_at' in task ? task.due_at : task.dueAt
    const ends = 'ends_at' in task ? task.ends_at : task.endsAt
    return new Date(due ?? ends ?? Date.now())
  }
  const ends = 'ends_at' in task ? task.ends_at : task.endsAt
  return new Date(ends ?? Date.now())
}

/** Duration in days (inclusive, minimum 1). */
export function taskDurationDays(task: StudyTaskWire | StudyTask): number {
  const start = taskStartDate(task)
  const end = taskEndDate(task)
  return Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1,
  )
}

/** ISO week number for a date (周一 = W01 basis). */
export function isoWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

/** Format a week label like "W28 7-13 Jul". */
export function weekLabel(weekStart: Date, timeZone: string): string {
  const wk = isoWeekNumber(weekStart)
  const fmtDay = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
  })
  const fmtDayMonth = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
  })
  const start = weekStart
  const end = new Date(weekStart.getTime() + 6 * 86_400_000)
  const sameMonth = start.getUTCMonth() === end.getUTCMonth()
  const range = sameMonth
    ? `${fmtDay.format(start)}-${fmtDayMonth.format(end)}`
    : `${fmtDayMonth.format(start)} – ${fmtDayMonth.format(end)}`
  return `W${wk} ${range}`
}

/** Monday of the week containing `date` (in timezone). */
export function startOfWeekInZone(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const y = Number(parts.find((p) => p.type === 'year')!.value)
  const m = Number(parts.find((p) => p.type === 'month')!.value)
  const d = Number(parts.find((p) => p.type === 'day')!.value)
  const wallMidnight = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  const offsetMs = wallClockOffsetMs(wallMidnight, timeZone)
  const localMidnight = new Date(wallMidnight.getTime() - offsetMs)
  const day = localMidnight.getUTCDay()
  const diff = (day + 6) % 7
  return new Date(localMidnight.getTime() - diff * 86_400_000)
}

function wallClockOffsetMs(instant: Date, timeZone: string): number {
  const utcParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (t: string) => Number(utcParts.find((p) => p.type === t)!.value)
  const wallMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  )
  return wallMs - instant.getTime()
}

/** Add days to a date. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

/** Format a date as a short date in the timezone. */
export function formatDateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(instant)
}

/** Format a date as a compact date (e.g. 14 Jul). */
export function formatShortDateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
  }).format(instant)
}

/** Detect resource conflicts for a task (overlaps with other study task resources). */
export function detectResourceConflicts(
  taskResources: StudyTaskResource[],
  allResources: StudyTaskResource[],
): StudyTaskResource[] {
  return taskResources.filter((tr) =>
    allResources.some(
      (other) =>
        other.id !== tr.id &&
        other.calendarResourceId === tr.calendarResourceId &&
        tstzRangeOverlap(other.startsAt, other.endsAt, tr.startsAt, tr.endsAt),
    ),
  )
}

function tstzRangeOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd)
}
