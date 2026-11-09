import {
  PLATE_DESIGN_ARCHIVE_TOOL,
  REPORT_GENERATE_TOOL,
  STUDIES_PROPOSE_TOOL_NAMES,
  STUDY_DELIVERABLE_ADD_TOOL,
  STUDY_TASK_ADD_TOOL,
  STUDY_TASK_UPDATE_TOOL,
  proposePlateDesignArchiveSchema,
  proposeReportGenerateSchema,
  proposeStudyDeliverableAddSchema,
  proposeStudyTaskAddSchema,
  proposeStudyTaskUpdateSchema,
} from './assistant-studies'
import type { StudiesProposeToolName } from './assistant-studies'
import { invalid, likeValue, toolDef } from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import { pick } from './assistant-upkeep.server'
import type { Lookup } from './assistant-upkeep.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * Cards for planning and reporting (see `assistant-studies.ts`). Each builder
 * finds what the person named under their own access, checks what it can, and
 * returns a card saying exactly what will change. Nothing is written here.
 */

export type StudiesOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isStudiesProposalTool(
  name: string,
): name is StudiesProposeToolName {
  return (STUDIES_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
}

export function studiesProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      STUDY_TASK_ADD_TOOL,
      `Propose adding a task or milestone to the study planner, in a project if they name one, with an optional due date and priority. ${NOTE}`,
      proposeStudyTaskAddSchema,
    ),
    toolDef(
      STUDY_TASK_UPDATE_TOOL,
      `Propose changing a planner task: its status, priority, progress or due date. A moved due date needs a reason, which is kept in the task’s history; ask for one. List the planner_tasks area first for the name. ${NOTE}`,
      proposeStudyTaskUpdateSchema,
    ),
    toolDef(
      STUDY_DELIVERABLE_ADD_TOOL,
      `Propose adding a deliverable (something a task or milestone must produce) to a planner task. ${NOTE}`,
      proposeStudyDeliverableAddSchema,
    ),
    toolDef(
      REPORT_GENERATE_TOOL,
      `Propose generating a report from its sections as they stand now. The result is kept with a checksum. List the reports area first for the title. ${NOTE}`,
      proposeReportGenerateSchema,
    ),
    toolDef(
      PLATE_DESIGN_ARCHIVE_TOOL,
      `Propose archiving a plate design so it no longer shows in lists. List the plate_designs area first for the name. ${NOTE}`,
      proposePlateDesignArchiveSchema,
    ),
  ]
}

const fail = (message: string): StudiesOutcome => ({ ok: false, message })

/** A date the person gave, as noon UTC so it never slips a day. */
const atNoon = (day: string) => `${day}T12:00:00Z`

interface TaskRow {
  id: string
  title: string
  status: string
  priority: string
  progress_percent: number
  due_at: string | null
  project_id: string | null
  metadata_version: number
  task_type: string
}

async function findTask(
  context: LabToolContext,
  text: string,
): Promise<Lookup<TaskRow>> {
  const rows = await context.client.list<TaskRow>(
    'study_tasks',
    `?title=ilike.${likeValue(text)}&select=id,title,status,priority,progress_percent,due_at,project_id,metadata_version,task_type&order=due_at.asc.nullslast&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    'planner task',
    (row) => row.title,
    (row) => row.title.toLowerCase() === lower,
  )
}

const taskLink = (task: { project_id: string | null }) =>
  task.project_id ? `/projects/${task.project_id}/milestones` : '/projects'

const dayText = (iso: string | null) => (iso ? iso.slice(0, 10) : 'No date')

export async function buildStudiesProposal(
  name: StudiesProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<StudiesOutcome> {
  const { client } = context
  switch (name) {
    case STUDY_TASK_ADD_TOOL: {
      const parsed = proposeStudyTaskAddSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      let project: { id: string; title: string } | null = null
      if (input.project) {
        const like = likeValue(input.project)
        const rows = await client.list<{
          id: string
          title: string
          key: string
        }>(
          'projects',
          `?or=(title.ilike.${like},key.ilike.${like})&select=id,title,key&limit=6`,
        )
        const lower = input.project.trim().toLowerCase()
        const found = pick(
          rows,
          input.project,
          'project',
          (row) => row.title,
          (row) =>
            row.title.toLowerCase() === lower ||
            row.key.toLowerCase() === lower,
        )
        if (!found.ok) return fail(found.message)
        project = found.value
      }
      const taskType = input.type ?? 'task'
      const changes: ProposalChange[] = [
        {
          label: taskType === 'milestone' ? 'Milestone' : 'Task',
          before: null,
          after: input.task.trim(),
        },
      ]
      if (project)
        changes.push({ label: 'Project', before: null, after: project.title })
      if (input.dueOn)
        changes.push({ label: 'Due', before: null, after: input.dueOn })
      if (input.priority)
        changes.push({ label: 'Priority', before: null, after: input.priority })
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: project ? `${project.title} · Planner` : 'Planner',
          deepLink: taskLink({ project_id: project?.id ?? null }),
          changes,
          action: {
            kind: 'study.task_add',
            workspaceId: context.workspaceId,
            title: input.task.trim(),
            taskType,
            projectId: project?.id ?? null,
            dueAt: input.dueOn ? atNoon(input.dueOn) : null,
            priority: input.priority ?? null,
            description: input.description ?? null,
          },
        },
      }
    }

    case STUDY_TASK_UPDATE_TOOL: {
      const parsed = proposeStudyTaskUpdateSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      if (input.dueOn && !input.reason)
        return fail(
          'Ask the person why the due date is moving; the reason is kept in the task’s history.',
        )
      const edit: {
        status?: (typeof input)['status']
        priority?: (typeof input)['priority']
        progressPercent?: number
      } = {}
      if (input.status) edit.status = input.status
      if (input.priority) edit.priority = input.priority
      if (input.progressPercent) edit.progressPercent = input.progressPercent
      if (Object.keys(edit).length === 0 && !input.dueOn)
        return fail(
          'Ask the person what to change: the status, priority, progress or due date.',
        )
      const found = await findTask(context, input.task)
      if (!found.ok) return fail(found.message)
      const task = found.value
      const changes: ProposalChange[] = []
      if (input.status)
        changes.push({
          label: 'Status',
          before: task.status,
          after: input.status,
        })
      if (input.priority)
        changes.push({
          label: 'Priority',
          before: task.priority,
          after: input.priority,
        })
      if (input.progressPercent)
        changes.push({
          label: 'Progress',
          before: `${task.progress_percent}%`,
          after: `${input.progressPercent}%`,
        })
      if (input.dueOn)
        changes.push({
          label: 'Due',
          before: dayText(task.due_at),
          after: input.dueOn,
        })
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${task.title} · Planner`,
          deepLink: taskLink(task),
          changes,
          action: {
            kind: 'study.task_update',
            taskId: task.id,
            expectedMetadataVersion: task.metadata_version,
            edit,
            move:
              input.dueOn && input.reason
                ? { dueAt: atNoon(input.dueOn), reason: input.reason }
                : null,
          },
        },
      }
    }

    case STUDY_DELIVERABLE_ADD_TOOL: {
      const parsed = proposeStudyDeliverableAddSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findTask(context, input.task)
      if (!found.ok) return fail(found.message)
      const task = found.value
      const changes: ProposalChange[] = [
        { label: 'Deliverable', before: null, after: input.name.trim() },
      ]
      if (input.dueOn)
        changes.push({ label: 'Due', before: null, after: input.dueOn })
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${task.title} · Planner`,
          deepLink: taskLink(task),
          changes,
          action: {
            kind: 'study.deliverable_add',
            taskId: task.id,
            name: input.name.trim(),
            dueAt: input.dueOn ? atNoon(input.dueOn) : null,
          },
        },
      }
    }

    case REPORT_GENERATE_TOOL: {
      const parsed = proposeReportGenerateSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const like = likeValue(input.report)
      const rows = await client.list<{
        id: string
        title: string
        document_identifier: string
        status: string
        version: number
      }>(
        'report_definitions',
        `?or=(title.ilike.${like},document_identifier.ilike.${like})&select=id,title,document_identifier,status,version&order=updated_at.desc&limit=6`,
      )
      const lower = input.report.trim().toLowerCase()
      const found = pick(
        rows,
        input.report,
        'report',
        (row) => `${row.document_identifier} ${row.title}`,
        (row) =>
          row.title.toLowerCase() === lower ||
          row.document_identifier.toLowerCase() === lower,
      )
      if (!found.ok) return fail(found.message)
      const report = found.value
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${report.document_identifier} · ${report.title}`,
          deepLink: `/reports/${report.id}`,
          changes: [
            {
              label: 'Report',
              before: null,
              after: `Generate from version ${report.version} as it stands now`,
            },
          ],
          action: {
            kind: 'report.generate',
            workspaceId: context.workspaceId,
            reportId: report.id,
          },
        },
      }
    }

    case PLATE_DESIGN_ARCHIVE_TOOL: {
      const parsed = proposePlateDesignArchiveSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const rows = await client.list<{
        id: string
        name: string
        status: string
        metadata_version: number
      }>(
        'plate_designs',
        `?name=ilike.${likeValue(input.design)}&status=neq.archived&select=id,name,status,metadata_version&order=updated_at.desc&limit=6`,
      )
      const lower = input.design.trim().toLowerCase()
      const found = pick(
        rows,
        input.design,
        'plate design',
        (row) => row.name,
        (row) => row.name.toLowerCase() === lower,
      )
      if (!found.ok) return fail(found.message)
      const design = found.value
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${design.name} · Plates`,
          deepLink: '/plates',
          changes: [
            { label: 'Status', before: design.status, after: 'archived' },
          ],
          action: {
            kind: 'plate_design.archive',
            designId: design.id,
            expectedMetadataVersion: design.metadata_version,
          },
        },
      }
    }
  }
}
