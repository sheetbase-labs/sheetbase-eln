import { z } from 'zod'

/**
 * Planning and reporting from the assistant: add a task or deliverable to the
 * study planner, change a task or move its due date, generate a report and
 * archive a plate design. Deleting a task, an analysis view or an analysis
 * definition is a card too; the button is the confirmation. Reading planner tasks, deliverables, reports, plate
 * designs and analysis views is the lab list tool's job (`planner_tasks`,
 * `planner_deliverables`, `reports`, `plate_designs` and `analysis_views`).
 *
 * Like the other cards, the model names things the way people do, the server
 * finds them and sends back a card, and nothing happens until the person
 * presses the button. The button runs the ordinary planner, report and plate
 * calls as the signed-in person, so permissions, versions and the audit trail
 * are the page's own.
 */

export const STUDY_TASK_ADD_TOOL = 'sheetbase.study.task_add'
export const STUDY_TASK_UPDATE_TOOL = 'sheetbase.study.task_update'
export const STUDY_DELIVERABLE_ADD_TOOL = 'sheetbase.study.deliverable_add'
export const REPORT_GENERATE_TOOL = 'sheetbase.report.generate'
export const PLATE_DESIGN_ARCHIVE_TOOL = 'sheetbase.plate_design.archive'
export const STUDY_TASK_DELETE_TOOL = 'sheetbase.study.task_delete'
export const ANALYSIS_VIEW_DELETE_TOOL = 'sheetbase.analysis_view.delete'
export const ANALYSIS_DEFINITION_DELETE_TOOL =
  'sheetbase.analysis_definition.delete'

export const STUDIES_PROPOSE_TOOL_NAMES = [
  STUDY_TASK_ADD_TOOL,
  STUDY_TASK_UPDATE_TOOL,
  STUDY_DELIVERABLE_ADD_TOOL,
  REPORT_GENERATE_TOOL,
  PLATE_DESIGN_ARCHIVE_TOOL,
  STUDY_TASK_DELETE_TOOL,
  ANALYSIS_VIEW_DELETE_TOOL,
  ANALYSIS_DEFINITION_DELETE_TOOL,
] as const

export type StudiesProposeToolName = (typeof STUDIES_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const STATUSES = [
  'not_started',
  'in_progress',
  'review',
  'completed',
  'blocked',
  'cancelled',
] as const
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

export const proposeStudyTaskAddSchema = z
  .object({
    title,
    summary,
    task: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'The name of the new task or milestone, in the person’s words.',
      ),
    type: z
      .enum(['task', 'milestone'])
      .optional()
      .describe('`milestone` for a date that matters. Default `task`.'),
    project: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The project it belongs to, by name or key, if they said.'),
    dueOn: day.optional().describe('When it is due, if they said.'),
    priority: z.enum(PRIORITIES).optional(),
    description: z.string().min(1).max(1000).optional(),
  })
  .strict()

export const proposeStudyTaskUpdateSchema = z
  .object({
    title,
    summary,
    task: z
      .string()
      .min(1)
      .max(200)
      .describe('The planner task, by words from its name.'),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    progressPercent: z.number().int().min(1).max(100).optional(),
    dueOn: day
      .optional()
      .describe(
        'A new due date. Needs a reason, which is kept in its history.',
      ),
    reason: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe('Why the due date moved, in the person’s words.'),
  })
  .strict()

export const proposeStudyDeliverableAddSchema = z
  .object({
    title,
    summary,
    task: z
      .string()
      .min(1)
      .max(200)
      .describe('The planner task or milestone it belongs to.'),
    name: z
      .string()
      .min(1)
      .max(200)
      .describe('What the task must produce, in the person’s words.'),
    dueOn: day.optional(),
  })
  .strict()

export const proposeReportGenerateSchema = z
  .object({
    title,
    summary,
    report: z
      .string()
      .min(1)
      .max(200)
      .describe('The report, by words from its title or its document number.'),
  })
  .strict()

export const proposePlateDesignArchiveSchema = z
  .object({
    title,
    summary,
    design: z
      .string()
      .min(1)
      .max(200)
      .describe('The plate design, by words from its name.'),
  })
  .strict()

export const proposeStudyTaskDeleteSchema = z
  .object({
    title,
    summary,
    task: z
      .string()
      .min(1)
      .max(200)
      .describe('The planner task or milestone to delete, by its name.'),
  })
  .strict()

export const proposeAnalysisViewDeleteSchema = z
  .object({
    title,
    summary,
    view: z
      .string()
      .min(1)
      .max(200)
      .describe('The saved analysis view to delete, by its name.'),
  })
  .strict()

export const proposeAnalysisDefinitionDeleteSchema = z
  .object({
    title,
    summary,
    definition: z
      .string()
      .min(1)
      .max(200)
      .describe('The saved analysis definition to delete, by its name.'),
  })
  .strict()

/** What a planning or reporting card does when its button is pressed. */
export type StudiesAction =
  | {
      kind: 'study.task_add'
      workspaceId: string
      title: string
      taskType: 'task' | 'milestone'
      projectId: string | null
      dueAt: string | null
      priority: (typeof PRIORITIES)[number] | null
      description: string | null
    }
  | {
      kind: 'study.task_update'
      taskId: string
      expectedMetadataVersion: number
      edit: {
        status?: (typeof STATUSES)[number]
        priority?: (typeof PRIORITIES)[number]
        progressPercent?: number
      }
      move: { dueAt: string; reason: string } | null
    }
  | {
      kind: 'study.deliverable_add'
      taskId: string
      name: string
      dueAt: string | null
    }
  | { kind: 'report.generate'; workspaceId: string; reportId: string }
  | {
      kind: 'plate_design.archive'
      designId: string
      expectedMetadataVersion: number
    }
  | { kind: 'study.task_delete'; taskId: string }
  | { kind: 'analysis_view.delete'; viewId: string }
  | { kind: 'analysis_definition.delete'; definitionId: string }

export type StudiesActionKind = StudiesAction['kind']

const KINDS: readonly string[] = [
  'study.task_add',
  'study.task_update',
  'study.deliverable_add',
  'report.generate',
  'plate_design.archive',
  'study.task_delete',
  'analysis_view.delete',
  'analysis_definition.delete',
]

export function isStudiesAction(action: {
  kind: string
}): action is StudiesAction {
  return KINDS.includes(action.kind)
}

export interface StudiesActionResult {
  openHref?: string
}
