import { z } from 'zod'

/**
 * Studies and the planner from the assistant. Like every write, each is a
 * card: the model names things the way the lab does (a study by its ID or
 * title, a task by its name), the server finds them and sends back a card that
 * says what will change, and nothing happens until the person presses its
 * button, which calls the ordinary RPC as them.
 *
 * The tool names are on the gateway allowlist through the operation
 * declarations (`assistant: { tool }` in `declarations/planning.ts`).
 */

export const STUDY_CREATE_TOOL = 'sheetbase.study.create'
export const STUDY_EDIT_TOOL = 'sheetbase.study.edit'
export const STUDY_ADD_EXPERIMENT_TOOL = 'sheetbase.study.add_experiment'
export const STUDY_ADD_PROJECT_TOOL = 'sheetbase.study.add_project'
export const STUDY_PLAN_SNAPSHOT_TOOL = 'sheetbase.study.plan_snapshot'
export const STUDY_WORKSTREAM_ADD_TOOL = 'sheetbase.study.workstream_add'
export const STUDY_TASK_MOVE_DUE_TOOL = 'sheetbase.study.task_move_due'
export const STUDY_TASK_SHARE_TOOL = 'sheetbase.study.task_share'
export const STUDY_DEPENDENCY_ADD_TOOL = 'sheetbase.study.dependency_add'
export const STUDY_DEPENDENCY_REMOVE_TOOL = 'sheetbase.study.dependency_remove'
export const STUDY_TASK_BOOK_TOOL = 'sheetbase.study.task_book'

export const STUDY_DELIVERABLE_UPDATE_TOOL =
  'sheetbase.study.deliverable_update'

export const STUDY_DELIVERABLE_REORDER_TOOL =
  'sheetbase.study.deliverable_reorder'

export const STUDY_DELIVERABLE_EVIDENCE_TOOL =
  'sheetbase.study.deliverable_evidence'

export const STUDIES_PROPOSE_TOOL_NAMES: readonly string[] = [
  STUDY_CREATE_TOOL,
  STUDY_EDIT_TOOL,
  STUDY_ADD_EXPERIMENT_TOOL,
  STUDY_ADD_PROJECT_TOOL,
  STUDY_PLAN_SNAPSHOT_TOOL,
  STUDY_WORKSTREAM_ADD_TOOL,
  STUDY_TASK_MOVE_DUE_TOOL,
  STUDY_TASK_SHARE_TOOL,
  STUDY_DEPENDENCY_ADD_TOOL,
  STUDY_DEPENDENCY_REMOVE_TOOL,
  STUDY_TASK_BOOK_TOOL,
  STUDY_DELIVERABLE_UPDATE_TOOL,
  STUDY_DELIVERABLE_REORDER_TOOL,
  STUDY_DELIVERABLE_EVIDENCE_TOOL,
]

export type StudiesProposeToolName =
  | typeof STUDY_CREATE_TOOL
  | typeof STUDY_EDIT_TOOL
  | typeof STUDY_ADD_EXPERIMENT_TOOL
  | typeof STUDY_ADD_PROJECT_TOOL
  | typeof STUDY_PLAN_SNAPSHOT_TOOL
  | typeof STUDY_WORKSTREAM_ADD_TOOL
  | typeof STUDY_TASK_MOVE_DUE_TOOL
  | typeof STUDY_TASK_SHARE_TOOL
  | typeof STUDY_DEPENDENCY_ADD_TOOL
  | typeof STUDY_DEPENDENCY_REMOVE_TOOL
  | typeof STUDY_TASK_BOOK_TOOL
  | typeof STUDY_DELIVERABLE_UPDATE_TOOL
  | typeof STUDY_DELIVERABLE_REORDER_TOOL
  | typeof STUDY_DELIVERABLE_EVIDENCE_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
  .describe('A date, YYYY-MM-DD.')

const studyRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The study, by its ID (STU-0004) or its title.')

const taskRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The planner task or milestone, by words from its name.')

export const STUDY_STATUSES = [
  'draft',
  'active',
  'on_hold',
  'completed',
  'cancelled',
] as const

export const DEPENDENCY_TYPES = [
  'finish_to_start',
  'start_to_start',
  'finish_to_finish',
  'start_to_finish',
] as const

export const DELIVERABLE_STATUSES = [
  'planned',
  'in_progress',
  'delivered',
  'overdue',
] as const

export const proposeStudyCreateSchema = z.strictObject({
  title,
  summary,
  study: z.string().min(1).max(200).describe('The new study’s title.'),
  project: z
    .string()
    .max(200)
    .optional()
    .describe('Its home project, by name, key or ID, if they said.'),
  description: z.string().max(1000).optional().describe('What it is for.'),
  startsOn: day.optional(),
  endsOn: day.optional(),
})

export const proposeStudyEditSchema = z.strictObject({
  title,
  summary,
  study: studyRef,
  name: z.string().min(1).max(200).optional().describe('A new title.'),
  status: z.enum(STUDY_STATUSES).optional(),
  description: z.string().max(1000).optional().describe('A new summary.'),
  startsOn: day.optional(),
  endsOn: day.optional(),
})

export const proposeStudyAddExperimentSchema = z.strictObject({
  title,
  summary,
  study: studyRef,
  experiment: z
    .string()
    .min(1)
    .max(200)
    .describe('The experiment, by its ID (EXP-0012) or its title.'),
  relationship: z
    .string()
    .max(60)
    .optional()
    .describe('How it takes part; `member` if left out.'),
})

export const proposeStudyAddProjectSchema = z.strictObject({
  title,
  summary,
  study: studyRef,
  project: z
    .string()
    .min(1)
    .max(200)
    .describe('The project, by name, key or ID.'),
  relationship: z
    .string()
    .max(60)
    .optional()
    .describe('How it takes part; `participating` if left out.'),
})

export const proposeStudyPlanSnapshotSchema = z.strictObject({
  title,
  summary,
  study: studyRef,
  reason: z.string().max(400).optional().describe('Why the plan is kept now.'),
})

export const proposeStudyWorkstreamAddSchema = z.strictObject({
  title,
  summary,
  name: z.string().min(1).max(120).describe('The lane’s name.'),
  project: z
    .string()
    .max(200)
    .optional()
    .describe('The project it belongs to, by name, key or ID, if any.'),
  color: z.string().max(20).optional(),
})

export const proposeStudyTaskMoveDueSchema = z.strictObject({
  title,
  summary,
  task: taskRef,
  dueOn: day.nullable().describe('The new due date, or null for none.'),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe('Why it moves; kept in the task’s history.'),
  notifyClient: z
    .boolean()
    .optional()
    .describe('Tell the client, when the task is shared with them.'),
})

export const proposeStudyTaskShareSchema = z.strictObject({
  title,
  summary,
  task: taskRef,
  visible: z
    .boolean()
    .describe('true shares it on the client portal, false stops sharing.'),
  reason: z.string().max(400).optional(),
})

export const proposeStudyDependencyAddSchema = z.strictObject({
  title,
  summary,
  before: taskRef.describe('The task that must come first (the predecessor).'),
  after: taskRef.describe('The task that waits for it (the successor).'),
  type: z
    .enum(DEPENDENCY_TYPES)
    .optional()
    .describe('`finish_to_start` if left out.'),
  lagDays: z.number().int().min(0).max(365).optional(),
})

export const proposeStudyDependencyRemoveSchema = z.strictObject({
  title,
  summary,
  before: taskRef.describe('The predecessor task.'),
  after: taskRef.describe('The successor task.'),
})

export const proposeStudyTaskBookSchema = z.strictObject({
  title,
  summary,
  task: taskRef,
  resource: z
    .string()
    .min(1)
    .max(200)
    .describe('The instrument or room, by its name or ID.'),
  startsAt: z
    .string()
    .min(1)
    .max(40)
    .describe('When the booking starts, local time, YYYY-MM-DDTHH:MM.'),
  endsAt: z
    .string()
    .min(1)
    .max(40)
    .describe('When it ends, local time, YYYY-MM-DDTHH:MM.'),
  notes: z.string().max(400).optional(),
})

export const proposeStudyDeliverableUpdateSchema = z.strictObject({
  title,
  summary,
  task: taskRef.describe('The task the deliverable belongs to.'),
  deliverable: z
    .string()
    .min(1)
    .max(200)
    .describe('The deliverable, by words from its name.'),
  name: z.string().min(1).max(200).optional().describe('A new name.'),
  description: z.string().max(1000).optional(),
  status: z.enum(DELIVERABLE_STATUSES).optional(),
  dueOn: day.optional(),
})

export const proposeStudyDeliverableReorderSchema = z.strictObject({
  title,
  summary,
  task: taskRef,
  order: z
    .array(z.string().min(1).max(200))
    .min(2)
    .max(40)
    .describe(
      'The task’s deliverables by name, in the order wanted. Name them all.',
    ),
})

export const proposeStudyDeliverableEvidenceSchema = z.strictObject({
  title,
  summary,
  task: taskRef,
  deliverable: z.string().min(1).max(200).describe('The deliverable, by name.'),
  record: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The experiment or record that shows it was met, by ID or title.',
    ),
})

/** What a card does when its button is pressed. */
export type StudiesAction =
  | {
      kind: 'study.create'
      workspaceId: string
      title: string
      projectId: string | null
      description: string | null
      startsOn: string | null
      endsOn: string | null
    }
  | {
      kind: 'study.edit'
      id: string
      metadataVersion: number
      title: string | null
      status: string | null
      description: string | null
      startsOn: string | null
      endsOn: string | null
    }
  | {
      kind: 'study.add_experiment'
      studyId: string
      experimentId: string
      relationship: string | null
    }
  | {
      kind: 'study.add_project'
      studyId: string
      projectId: string
      relationship: string | null
    }
  | { kind: 'study.plan_snapshot'; studyId: string; reason: string | null }
  | {
      kind: 'study.workstream_add'
      workspaceId: string
      name: string
      projectId: string | null
      color: string | null
    }
  | {
      kind: 'study.task_move_due'
      taskId: string
      metadataVersion: number
      dueAt: string | null
      reason: string
      notifyClient: boolean
    }
  | {
      kind: 'study.task_share'
      taskId: string
      metadataVersion: number
      visible: boolean
      reason: string | null
    }
  | {
      kind: 'study.dependency_add'
      workspaceId: string
      predecessorId: string
      successorId: string
      dependencyType: (typeof DEPENDENCY_TYPES)[number]
      lagDays: number
    }
  | { kind: 'study.dependency_remove'; dependencyId: string }
  | {
      kind: 'study.task_book'
      workspaceId: string
      taskId: string
      resourceId: string
      startsAt: string
      endsAt: string
      notes: string | null
    }
  | {
      kind: 'study.deliverable_update'
      id: string
      name: string | null
      description: string | null
      status: string | null
      dueAt: string | null
    }
  | { kind: 'study.deliverable_reorder'; taskId: string; ids: string[] }
  | { kind: 'study.deliverable_evidence'; id: string; recordId: string }

const STUDIES_ACTIONS = new Set([
  'study.create',
  'study.edit',
  'study.add_experiment',
  'study.add_project',
  'study.plan_snapshot',
  'study.workstream_add',
  'study.task_move_due',
  'study.task_share',
  'study.dependency_add',
  'study.dependency_remove',
  'study.task_book',
  'study.deliverable_update',
  'study.deliverable_reorder',
  'study.deliverable_evidence',
])

export function isStudiesAction(action: {
  kind: string
}): action is StudiesAction {
  return STUDIES_ACTIONS.has(action.kind)
}
