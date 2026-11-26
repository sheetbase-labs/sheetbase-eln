import { z } from 'zod'

/**
 * Reports from the assistant. Like every write, each is a card: the model
 * names a report by its document number or title and a section by its title,
 * the server finds them and sends back a card that says what will change, and
 * nothing happens until the person presses its button, which calls the
 * ordinary RPC as them.
 *
 * Tool names are on the gateway allowlist through the operation declarations
 * (`assistant: { tool }`) and, for the scheduled-report calls that have no
 * operation yet, `agent-tool-catalogue.ts`.
 */

export const REPORT_CREATE_TOOL = 'sheetbase.report.create'
export const REPORT_UPDATE_TOOL = 'sheetbase.report.update'
export const REPORT_SECTION_ADD_TOOL = 'sheetbase.report.section_add'
export const REPORT_SECTION_UPDATE_TOOL = 'sheetbase.report.section_update'
export const REPORT_SECTION_BIND_TOOL = 'sheetbase.report.section_bind'
export const REPORT_SECTION_REMOVE_TOOL = 'sheetbase.report.section_remove'
export const REPORT_SECTIONS_REORDER_TOOL = 'sheetbase.report.sections_reorder'
export const REPORT_SCHEDULE_SAVE_TOOL = 'sheetbase.report.schedule_save'
export const REPORT_SCHEDULE_ACTIVE_TOOL = 'sheetbase.report.schedule_active'
export const REPORT_SCHEDULE_SEND_TOOL = 'sheetbase.report.schedule_send'
export const REPORT_SCHEDULE_DELETE_TOOL = 'sheetbase.report.schedule_delete'

export const REPORTS_PROPOSE_TOOL_NAMES: readonly string[] = [
  REPORT_CREATE_TOOL,
  REPORT_UPDATE_TOOL,
  REPORT_SECTION_ADD_TOOL,
  REPORT_SECTION_UPDATE_TOOL,
  REPORT_SECTION_BIND_TOOL,
  REPORT_SECTION_REMOVE_TOOL,
  REPORT_SECTIONS_REORDER_TOOL,
  REPORT_SCHEDULE_SAVE_TOOL,
  REPORT_SCHEDULE_ACTIVE_TOOL,
  REPORT_SCHEDULE_SEND_TOOL,
  REPORT_SCHEDULE_DELETE_TOOL,
]

export type ReportsProposeToolName =
  | typeof REPORT_CREATE_TOOL
  | typeof REPORT_UPDATE_TOOL
  | typeof REPORT_SECTION_ADD_TOOL
  | typeof REPORT_SECTION_UPDATE_TOOL
  | typeof REPORT_SECTION_BIND_TOOL
  | typeof REPORT_SECTION_REMOVE_TOOL
  | typeof REPORT_SECTIONS_REORDER_TOOL
  | typeof REPORT_SCHEDULE_SAVE_TOOL
  | typeof REPORT_SCHEDULE_ACTIVE_TOOL
  | typeof REPORT_SCHEDULE_SEND_TOOL
  | typeof REPORT_SCHEDULE_DELETE_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

const reportRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The report, by its document number or words from its title.')

const sectionRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The section, by words from its title.')

/** Approving and publishing a report are signed off by a person in the app. */
export const REPORT_CARD_STATUSES = ['draft', 'in_review', 'archived'] as const

export const SECTION_TYPES = ['text', 'chart', 'table', 'file'] as const

export const SCHEDULE_KINDS = [
  'instrument_usage',
  'spend',
  'project_status',
] as const

export const SCHEDULE_PERIODS = [
  'previous_week',
  'previous_month',
  'last_7_days',
  'last_30_days',
] as const

export const SCHEDULE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export const proposeReportCreateSchema = z.strictObject({
  title,
  summary,
  report: z.string().min(1).max(200).describe('The new report’s title.'),
  subtitle: z.string().max(200).optional(),
  project: z
    .string()
    .max(200)
    .optional()
    .describe('The project it is in, by name, key or ID, if they said.'),
})

export const proposeReportUpdateSchema = z.strictObject({
  title,
  summary,
  report: reportRef,
  name: z.string().min(1).max(200).optional().describe('A new title.'),
  subtitle: z.string().max(200).optional(),
  status: z
    .enum(REPORT_CARD_STATUSES)
    .optional()
    .describe(
      'Draft, in review or archived. Approving or publishing is done by a person in the app.',
    ),
})

export const proposeReportSectionAddSchema = z.strictObject({
  title,
  summary,
  report: reportRef,
  section: z.string().min(1).max(200).describe('The new section’s title.'),
  description: z.string().max(2000).optional().describe('Its text.'),
  type: z.enum(SECTION_TYPES).optional().describe('`text` if left out.'),
})

export const proposeReportSectionUpdateSchema = z.strictObject({
  title,
  summary,
  report: reportRef,
  section: sectionRef,
  name: z.string().min(1).max(200).optional().describe('A new title.'),
  description: z.string().max(2000).optional(),
  type: z.enum(SECTION_TYPES).optional(),
  position: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Where it goes in the report, counting from 1.'),
})

export const proposeReportSectionBindSchema = z.strictObject({
  title,
  summary,
  report: reportRef,
  section: sectionRef,
  record: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The experiment or record whose submitted version the section shows, by ID or title.',
    ),
  block: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Which block of it, by words from its text or its type; needed when the record has several.',
    ),
  version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('A submitted version; the latest if left out.'),
})

export const proposeReportSectionRemoveSchema = z.strictObject({
  title,
  summary,
  report: reportRef,
  section: sectionRef,
})

export const proposeReportSectionsReorderSchema = z.strictObject({
  title,
  summary,
  report: reportRef,
  order: z
    .array(z.string().min(1).max(200))
    .min(2)
    .max(100)
    .describe(
      'The sections by title, in the order wanted. Name every section.',
    ),
})

export const proposeReportScheduleSaveSchema = z.strictObject({
  title,
  summary,
  schedule: z
    .string()
    .min(1)
    .max(120)
    .describe(
      'The schedule’s name. If a schedule with this name exists, it is changed; otherwise a new one is made.',
    ),
  report: z
    .enum(SCHEDULE_KINDS)
    .describe(
      'What is sent: instrument_usage, spend (on orders) or project_status.',
    ),
  project: z
    .string()
    .max(200)
    .optional()
    .describe('Limit it to one project, by name, key or ID.'),
  period: z
    .enum(SCHEDULE_PERIODS)
    .describe('The stretch of time it covers; always a finished one.'),
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  weekday: z
    .enum(WEEKDAYS)
    .optional()
    .describe('For weekly: the day. Monday if left out.'),
  monthDay: z
    .number()
    .int()
    .min(1)
    .max(28)
    .optional()
    .describe('For monthly: the day of the month, 1 to 28.'),
  hour: z
    .number()
    .int()
    .min(0)
    .max(23)
    .optional()
    .describe('The hour it is sent, in the person’s time zone. 8 if left out.'),
  recipients: z
    .array(z.string().min(1).max(120))
    .min(1)
    .max(30)
    .describe('Who gets it, by name; they must be members of the workspace.'),
  openHours: z
    .number()
    .min(1)
    .max(24)
    .optional()
    .describe('Open hours a weekday, for instrument utilisation.'),
})

export const proposeReportScheduleActiveSchema = z.strictObject({
  title,
  summary,
  schedule: z
    .string()
    .min(1)
    .max(120)
    .describe('The scheduled report, by name.'),
  active: z.boolean().describe('false pauses it, true resumes it.'),
})

export const proposeReportScheduleSendSchema = z.strictObject({
  title,
  summary,
  schedule: z
    .string()
    .min(1)
    .max(120)
    .describe('The scheduled report, by name.'),
})

export const proposeReportScheduleDeleteSchema = z.strictObject({
  title,
  summary,
  schedule: z
    .string()
    .min(1)
    .max(120)
    .describe('The scheduled report, by name.'),
})

/** What a card does when its button is pressed. */
export type ReportsAction =
  | {
      kind: 'report.create'
      workspaceId: string
      title: string
      subtitle: string | null
      projectId: string | null
    }
  | {
      kind: 'report.update'
      workspaceId: string
      id: string
      title: string | null
      subtitle: string | null
      status: (typeof REPORT_CARD_STATUSES)[number] | null
    }
  | {
      kind: 'report.section_add'
      workspaceId: string
      reportId: string
      title: string
      description: string | null
      sectionType: (typeof SECTION_TYPES)[number]
    }
  | {
      kind: 'report.section_update'
      workspaceId: string
      reportId: string
      sectionId: string
      title: string | null
      description: string | null
      sectionType: (typeof SECTION_TYPES)[number] | null
      position: number | null
    }
  | {
      kind: 'report.section_bind'
      workspaceId: string
      reportId: string
      sectionId: string
      revisionId: string
      source: {
        blockId: string
        recordId: string
        recordIdentifier: string
        revisionVersion: number
      }
    }
  | {
      kind: 'report.section_remove'
      workspaceId: string
      reportId: string
      sectionId: string
    }
  | {
      kind: 'report.sections_reorder'
      workspaceId: string
      reportId: string
      sectionIds: string[]
    }
  | {
      kind: 'report.schedule_save'
      id: string | null
      name: string
      reportKind: (typeof SCHEDULE_KINDS)[number]
      projectId: string | null
      period: (typeof SCHEDULE_PERIODS)[number]
      openHours: number
      frequency: (typeof SCHEDULE_FREQUENCIES)[number]
      weekday: number
      monthDay: number
      sendHour: number
      timeZone: string
      recipientUserIds: string[]
      active: boolean
    }
  | { kind: 'report.schedule_active'; id: string; active: boolean }
  | { kind: 'report.schedule_send'; id: string }
  | { kind: 'report.schedule_delete'; id: string }

const REPORTS_ACTIONS = new Set([
  'report.create',
  'report.update',
  'report.section_add',
  'report.section_update',
  'report.section_bind',
  'report.section_remove',
  'report.sections_reorder',
  'report.schedule_save',
  'report.schedule_active',
  'report.schedule_send',
  'report.schedule_delete',
])

export function isReportsAction(action: {
  kind: string
}): action is ReportsAction {
  return REPORTS_ACTIONS.has(action.kind)
}
