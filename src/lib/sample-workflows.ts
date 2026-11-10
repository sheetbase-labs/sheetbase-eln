/**
 * Sample workflows: the steps a sample moves through in a lab, set up by an
 * admin. A workflow has ordered steps; each says where a sample may go next, what
 * must be filled in first, how long it should stay, and what happens on arrival.
 * The database checks every move, so this module only shapes data for the screens.
 */
import { z } from 'zod'

import { t } from '#/copy'
import type { DataClient } from '#/lib/data-client'

export type WorkflowAction =
  | { kind: 'notify'; to: string; message?: string }
  | { kind: 'set_field'; key: string; value: string }
  | { kind: 'quarantine'; reason?: string }
  | { kind: 'start_experiment'; templateId: string; projectId?: string }

export type WorkflowActionKind = WorkflowAction['kind']

export const ACTION_KINDS: readonly WorkflowActionKind[] = [
  'notify',
  'set_field',
  'quarantine',
  'start_experiment',
]

/** Who a notify automation tells. */
export const NOTIFY_ROLES = [
  'steward',
  'scientist',
  'reviewer',
  'admin',
  'owner',
] as const

/** A step as the editor holds it. `key` ties `next` to steps before they have ids. */
export interface WorkflowStageDraft {
  key: string
  id?: string
  name: string
  description: string
  turnaroundDays: string
  final: boolean
  requiredFields: string[]
  actions: WorkflowAction[]
  next: string[]
}

export interface WorkflowDraft {
  id: string | null
  name: string
  description: string
  sampleType: string
  autoEnrol: boolean
  status: 'active' | 'archived'
  stages: WorkflowStageDraft[]
}

export interface WorkflowSummary {
  id: string
  name: string
  description: string | null
  sampleType: string | null
  autoEnrol: boolean
  status: 'active' | 'archived'
  stageCount: number
  inProgress: number
}

export interface WorkflowRun {
  id: string
  workflowId: string
  workflowName: string
  stageId: string
  stageName: string
  enteredAt: string
  dueAt: string | null
  completedAt: string | null
  /** Steps this sample may move to now. */
  moves: { id: string; name: string; requiredFields: string[] }[]
}

export interface WorkflowEvent {
  id: string
  from: string | null
  to: string | null
  notes: string | null
  actor: string | null
  at: string
  automation: { kind: string; outcome: 'done' | 'failed'; message: string }[]
}

export const workflowKeys = {
  all: (workspaceId: string) => ['sample-workflows', workspaceId] as const,
  sample: (sampleId: string) => ['sample-workflow-runs', sampleId] as const,
}

/** Sample fields a person can ask for or set; any model field name also works. */
export const COMMON_SAMPLE_FIELDS = [
  'storageLocation',
  'barcode',
  'sampleType',
  'quantity',
  'quantityUnit',
  'expiryDate',
  'notes',
] as const

let draftCounter = 0

export function newStageKey(): string {
  draftCounter += 1

  return `new-${Date.now().toString(36)}-${draftCounter}`
}

export function blankStage(name = ''): WorkflowStageDraft {
  return {
    key: newStageKey(),
    name,
    description: '',
    turnaroundDays: '',
    final: false,
    requiredFields: [],
    actions: [],
    next: [],
  }
}

/** Two steps that lead on to each other, so a new workflow is saveable at once. */
export function blankWorkflow(): WorkflowDraft {
  const first = blankStage(t('settings.sampleWorkflows.firstStepName'))
  const last = blankStage(t('settings.sampleWorkflows.lastStepName'))
  last.final = true
  first.next = [last.key]

  return {
    id: null,
    name: '',
    description: '',
    sampleType: '',
    autoEnrol: false,
    status: 'active',
    stages: [first, last],
  }
}

export function blankAction(kind: WorkflowActionKind): WorkflowAction {
  switch (kind) {
    case 'notify':
      return { kind, to: 'owner' }
    case 'set_field':
      return { kind, key: '', value: '' }
    case 'quarantine':
      return { kind }
    case 'start_experiment':
      return { kind, templateId: '' }
  }
}

/** A stored automation, as the definition's JSONB carries it. */
const STORED_ACTION = z.looseObject({
  kind: z.string(),
  to: z.string().optional(),
  message: z.string().optional(),
  key: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).catch(''),
  reason: z.string().optional(),
  templateId: z.string().optional(),
  projectId: z.string().optional(),
})

function asAction(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored automation is JSONB from the definition row; `STORED_ACTION` decides what it is.
  raw: unknown,
): WorkflowAction | null {
  const parsed = STORED_ACTION.safeParse(raw)

  if (!parsed.success) return null

  const r = parsed.data

  switch (r.kind) {
    case 'notify':
      return {
        kind: 'notify',
        to: r.to || 'owner',
        message: r.message ?? '',
      }
    case 'set_field':
      return {
        kind: 'set_field',
        key: r.key ?? '',
        value: String(r.value),
      }
    case 'quarantine':
      return { kind: 'quarantine', reason: r.reason ?? '' }
    case 'start_experiment':
      return {
        kind: 'start_experiment',
        templateId: r.templateId ?? '',
        projectId: r.projectId || undefined,
      }
    default:
      return null
  }
}

interface WorkflowRow {
  id: string
  name: string
  description: string | null
  sample_type: string | null
  auto_enrol: boolean
  status: 'active' | 'archived'
}

interface StageRow {
  id: string
  workflow_id: string
  position: number
  name: string
  description: string | null
  turnaround_days: number | null
  is_final: boolean
  required_fields: string[]
  actions: unknown
}

interface TransitionRow {
  workflow_id: string
  from_stage_id: string
  to_stage_id: string
}

export async function fetchWorkflowSummaries(
  client: DataClient,
): Promise<WorkflowSummary[]> {
  const [workflows, stages, runs] = await Promise.all([
    client.list<WorkflowRow>('sample_workflows', '?select=*&order=name'),
    client.list<{ workflow_id: string }>(
      'sample_workflow_stages',
      '?select=workflow_id&limit=5000',
    ),
    client.list<{ workflow_id: string }>(
      'sample_workflow_runs',
      '?select=workflow_id&completed_at=is.null&limit=20000',
    ),
  ])

  const count = (rows: { workflow_id: string }[], id: string) =>
    rows.filter((row) => row.workflow_id === id).length

  return workflows.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    sampleType: w.sample_type,
    autoEnrol: w.auto_enrol,
    status: w.status,
    stageCount: count(stages, w.id),
    inProgress: count(runs, w.id),
  }))
}

export async function fetchWorkflowDraft(
  client: DataClient,
  workflowId: string,
): Promise<WorkflowDraft> {
  const id = encodeURIComponent(workflowId)

  const [workflows, stages, transitions] = await Promise.all([
    client.list<WorkflowRow>('sample_workflows', `?id=eq.${id}&select=*`),
    client.list<StageRow>(
      'sample_workflow_stages',
      `?workflow_id=eq.${id}&select=*&order=position`,
    ),
    client.list<TransitionRow>(
      'sample_workflow_transitions',
      `?workflow_id=eq.${id}&select=*`,
    ),
  ])

  if (workflows.length === 0)
    throw new Error(t('settings.sampleWorkflows.notFound'))
  const w = workflows[0]

  return {
    id: w.id,
    name: w.name,
    description: w.description ?? '',
    sampleType: w.sample_type ?? '',
    autoEnrol: w.auto_enrol,
    status: w.status,
    stages: stages.map((s) => ({
      key: s.id,
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      turnaroundDays:
        s.turnaround_days == null ? '' : String(s.turnaround_days),
      final: s.is_final,
      requiredFields: s.required_fields,
      actions: (Array.isArray(s.actions) ? s.actions : [])
        .map(asAction)
        .filter((a): a is WorkflowAction => a !== null),
      next: transitions
        .filter((tr) => tr.from_stage_id === s.id)
        .map((tr) => tr.to_stage_id),
    })),
  }
}

/** One automation as the database takes it. */
interface WorkflowActionWire {
  kind: WorkflowActionKind
  to?: string
  message?: string
  key?: string
  value?: string
  reason?: string
  templateId?: string
  projectId?: string
}

/** One step as the database takes it. */
interface WorkflowStageWire {
  key: string
  id?: string
  name: string
  description: string
  turnaroundDays: number | null
  final: boolean
  requiredFields: string[]
  actions: WorkflowActionWire[]
  next: string[]
}

/** The definition as the database takes it. */
interface WorkflowDefinitionWire {
  name: string
  description: string
  sampleType: string
  autoEnrol: boolean
  stages: WorkflowStageWire[]
}

/** The definition as the database takes it. */
export function draftToWire(draft: WorkflowDraft): WorkflowDefinitionWire {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    sampleType: draft.sampleType.trim(),
    autoEnrol: draft.autoEnrol,
    stages: draft.stages.map((s) => ({
      key: s.key,
      id: s.id,
      name: s.name.trim(),
      description: s.description.trim(),
      turnaroundDays: s.turnaroundDays.trim() ? Number(s.turnaroundDays) : null,
      final: s.final,
      requiredFields: s.requiredFields.map((f) => f.trim()).filter(Boolean),
      actions: s.actions.map(actionToWire),
      next: s.final ? [] : s.next,
    })),
  }
}

export function actionToWire(action: WorkflowAction): WorkflowActionWire {
  switch (action.kind) {
    case 'notify': {
      const wire: WorkflowActionWire = { kind: 'notify', to: action.to }
      const message = action.message?.trim()

      if (message) wire.message = message

      return wire
    }

    case 'set_field':
      return { kind: 'set_field', key: action.key.trim(), value: action.value }
    case 'quarantine': {
      const wire: WorkflowActionWire = { kind: 'quarantine' }
      const reason = action.reason?.trim()

      if (reason) wire.reason = reason

      return wire
    }

    case 'start_experiment': {
      const wire: WorkflowActionWire = {
        kind: 'start_experiment',
        templateId: action.templateId,
      }

      if (action.projectId) wire.projectId = action.projectId

      return wire
    }
  }
}

export async function saveWorkflow(
  client: DataClient,
  draft: WorkflowDraft,
): Promise<string> {
  return client.rpc<string>('save_sample_workflow', {
    p_workflow_id: draft.id,
    p_definition: draftToWire(draft),
  })
}

export async function setWorkflowStatus(
  client: DataClient,
  workflowId: string,
  status: 'active' | 'archived',
): Promise<void> {
  await client.rpc('set_sample_workflow_status', {
    p_workflow_id: workflowId,
    p_status: status,
  })
}

/** The first thing wrong with a workflow, in words a scientist would use. */
export function validateWorkflow(draft: WorkflowDraft): string | null {
  if (!draft.name.trim()) return t('settings.sampleWorkflows.needName')

  if (draft.stages.length < 2) return t('settings.sampleWorkflows.needTwoSteps')
  const names = new Set<string>()

  for (const stage of draft.stages) {
    const name = stage.name.trim()

    if (!name) return t('settings.sampleWorkflows.needStepName')

    if (names.has(name.toLowerCase()))
      return t('settings.sampleWorkflows.duplicateStep', { name })
    names.add(name.toLowerCase())

    if (stage.turnaroundDays.trim()) {
      const days = Number(stage.turnaroundDays)

      if (!Number.isInteger(days) || days < 1)
        return t('settings.sampleWorkflows.turnaroundWhole', { name })
    }

    for (const action of stage.actions) {
      const problem = validateAction(action)

      if (problem) return `${name}: ${problem}`
    }
  }

  if (!draft.stages.some((s) => s.final))
    return t('settings.sampleWorkflows.needFinalStep')
  const reachable = new Set<string>([draft.stages[0].key])
  const queue = [draft.stages[0].key]
  const stageByKey = new Map(draft.stages.map((s) => [s.key, s]))

  while (queue.length) {
    const key = queue.pop()

    if (key === undefined) break

    const stage = stageByKey.get(key)

    for (const next of stage && !stage.final ? stage.next : []) {
      if (!reachable.has(next)) {
        reachable.add(next)
        queue.push(next)
      }
    }
  }

  const stranded = draft.stages.find((s) => !reachable.has(s.key))

  if (stranded)
    return t('settings.sampleWorkflows.unreachable', { name: stranded.name })
  const stuck = draft.stages.find((s) => !s.final && s.next.length === 0)

  if (stuck) return t('settings.sampleWorkflows.deadEnd', { name: stuck.name })

  return null
}

export function validateAction(action: WorkflowAction): string | null {
  if (action.kind === 'set_field' && !action.key.trim())
    return t('settings.sampleWorkflows.needFieldName')

  if (action.kind === 'start_experiment' && !action.templateId)
    return t('settings.sampleWorkflows.needTemplate')

  return null
}

/** One line saying what an automation does. */
export function describeAction(action: WorkflowAction): string {
  switch (action.kind) {
    case 'notify':
      return t('settings.sampleWorkflows.describe.notify', {
        who: describeAudience(action.to),
      })
    case 'set_field':
      return t('settings.sampleWorkflows.describe.setField', {
        field: action.key || '…',
        value: action.value,
      })
    case 'quarantine':
      return t('settings.sampleWorkflows.describe.quarantine')
    case 'start_experiment':
      return t('settings.sampleWorkflows.describe.startExperiment')
  }
}

export function describeAudience(to: string): string {
  return to.startsWith('role:')
    ? t('settings.sampleWorkflows.audience.role', { role: to.slice(5) })
    : t('settings.sampleWorkflows.audience.owner')
}

// -- on a sample ------------------------------------------------------------

interface RunRow {
  id: string
  workflow_id: string
  stage_id: string
  entered_at: string
  due_at: string | null
  completed_at: string | null
  workflow: { name: string } | null
  stage: { name: string } | null
}

/** The workflows a sample is in (or finished), with where it can go next. */
export async function fetchSampleRuns(
  client: DataClient,
  sampleId: string,
): Promise<WorkflowRun[]> {
  const rows = await client.list<RunRow>(
    'sample_workflow_runs',
    `?record_id=eq.${encodeURIComponent(sampleId)}&select=id,workflow_id,stage_id,entered_at,due_at,completed_at,workflow:sample_workflows(name),stage:sample_workflow_stages(name)&order=entered_at.desc`,
  )

  const open = rows.filter((row) => !row.completed_at)
  const stageIds = open.map((row) => row.stage_id)

  const moves = stageIds.length
    ? await client.list<{
        from_stage_id: string
        to: { id: string; name: string; required_fields: string[] }
      }>(
        'sample_workflow_transitions',
        `?from_stage_id=in.(${stageIds.join(',')})&select=from_stage_id,to:sample_workflow_stages!sample_workflow_transitions_to_fk(id,name,required_fields)&order=to_stage_id`,
      )
    : []

  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow?.name ?? '',
    stageId: row.stage_id,
    stageName: row.stage?.name ?? '',
    enteredAt: row.entered_at,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    moves: moves
      .filter((m) => m.from_stage_id === row.stage_id)
      .map((m) => ({
        id: m.to.id,
        name: m.to.name,
        requiredFields: m.to.required_fields,
      })),
  }))
}

export async function fetchSampleWorkflowEvents(
  client: DataClient,
  sampleId: string,
): Promise<WorkflowEvent[]> {
  const rows = await client.list<{
    id: string
    from_stage_name: string | null
    to_stage_name: string | null
    notes: string | null
    actor_user_id: string | null
    created_at: string
    automation: WorkflowEvent['automation']
  }>(
    'sample_workflow_events',
    `?record_id=eq.${encodeURIComponent(sampleId)}&select=*&order=created_at.desc&limit=50`,
  )

  return rows.map((row) => ({
    id: row.id,
    from: row.from_stage_name,
    to: row.to_stage_name,
    notes: row.notes,
    actor: row.actor_user_id,
    at: row.created_at,
    automation: Array.isArray(row.automation) ? row.automation : [],
  }))
}

/** Workflows a sample could start, given its type. */
export async function fetchStartableWorkflows(
  client: DataClient,
  sampleType: string | null,
): Promise<{ id: string; name: string }[]> {
  const rows = await client.list<WorkflowRow>(
    'sample_workflows',
    '?status=eq.active&select=*&order=name',
  )

  return rows
    .filter((row) => !row.sample_type || row.sample_type === sampleType)
    .map((row) => ({ id: row.id, name: row.name }))
}

export async function enrolSample(
  client: DataClient,
  sampleId: string,
  workflowId: string,
): Promise<void> {
  await client.rpc('enrol_sample_in_workflow', {
    p_record_id: sampleId,
    p_workflow_id: workflowId,
  })
}

export async function advanceRun(
  client: DataClient,
  runId: string,
  toStageId: string,
  notes?: string,
): Promise<{ automation: WorkflowEvent['automation'] }> {
  return client.rpc('advance_sample_workflow', {
    p_run_id: runId,
    p_to_stage_id: toStageId,
    p_notes: notes?.trim() || null,
  })
}

export async function leaveRun(
  client: DataClient,
  runId: string,
): Promise<void> {
  await client.rpc('leave_sample_workflow', { p_run_id: runId })
}

/** Whole days until a due date; negative once overdue. */
export function daysUntil(due: string | null, now = Date.now()): number | null {
  if (!due) return null

  return Math.ceil((new Date(due).getTime() - now) / 86_400_000)
}
