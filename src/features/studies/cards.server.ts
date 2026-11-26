import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { instantFromLocal } from '#/lib/assistant-booking'
import {
  NOTE,
  atNoon,
  card,
  dayText,
  fail,
  find,
  findRecordOf,
} from '#/lib/assistant-kit.server'
import { findProject } from '#/lib/assistant-labwork.server'
import { invalid, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { ProposalChange } from '#/lib/assistant-proposals'
import type { DataClient } from '#/lib/data-client'

import type { FeatureProposalOutcome } from '../define.server'
import {
  STUDIES_PROPOSE_TOOL_NAMES,
  STUDY_ADD_EXPERIMENT_TOOL,
  STUDY_ADD_PROJECT_TOOL,
  STUDY_CREATE_TOOL,
  STUDY_DELIVERABLE_EVIDENCE_TOOL,
  STUDY_DELIVERABLE_REORDER_TOOL,
  STUDY_DELIVERABLE_UPDATE_TOOL,
  STUDY_DEPENDENCY_ADD_TOOL,
  STUDY_DEPENDENCY_REMOVE_TOOL,
  STUDY_EDIT_TOOL,
  STUDY_PLAN_SNAPSHOT_TOOL,
  STUDY_TASK_BOOK_TOOL,
  STUDY_TASK_MOVE_DUE_TOOL,
  STUDY_TASK_SHARE_TOOL,
  STUDY_WORKSTREAM_ADD_TOOL,
  proposeStudyAddExperimentSchema,
  proposeStudyAddProjectSchema,
  proposeStudyCreateSchema,
  proposeStudyDeliverableEvidenceSchema,
  proposeStudyDeliverableReorderSchema,
  proposeStudyDeliverableUpdateSchema,
  proposeStudyDependencyAddSchema,
  proposeStudyDependencyRemoveSchema,
  proposeStudyEditSchema,
  proposeStudyPlanSnapshotSchema,
  proposeStudyTaskBookSchema,
  proposeStudyTaskMoveDueSchema,
  proposeStudyTaskShareSchema,
  proposeStudyWorkstreamAddSchema,
} from './cards'
import type { StudiesProposeToolName } from './cards'

/**
 * The study and planner cards (see `cards.ts`). Each builder finds what the
 * model named under the signed-in person's own access, by ID as well as by
 * name, and returns a card that says exactly what will change. Nothing is
 * written here.
 */

export function isStudiesProposalTool(
  name: string,
): name is StudiesProposeToolName {
  return STUDIES_PROPOSE_TOOL_NAMES.includes(name)
}

export function studiesProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      STUDY_CREATE_TOOL,
      `Propose starting a study: a record that groups projects and experiments and carries the plan, with an optional home project, summary and dates. ${NOTE}`,
      proposeStudyCreateSchema,
    ),
    toolDef(
      STUDY_EDIT_TOOL,
      `Propose changing a study: its title, status, summary or dates. ${NOTE}`,
      proposeStudyEditSchema,
    ),
    toolDef(
      STUDY_ADD_EXPERIMENT_TOOL,
      `Propose making an experiment part of a study. ${NOTE}`,
      proposeStudyAddExperimentSchema,
    ),
    toolDef(
      STUDY_ADD_PROJECT_TOOL,
      `Propose making a project take part in a study. ${NOTE}`,
      proposeStudyAddProjectSchema,
    ),
    toolDef(
      STUDY_PLAN_SNAPSHOT_TOOL,
      `Propose keeping a snapshot of a study's plan as it stands, so a later change can be compared with it. ${NOTE}`,
      proposeStudyPlanSnapshotSchema,
    ),
    toolDef(
      STUDY_WORKSTREAM_ADD_TOOL,
      `Propose adding a workstream (a lane that groups tasks) to the study planner. ${NOTE}`,
      proposeStudyWorkstreamAddSchema,
    ),
    toolDef(
      STUDY_TASK_MOVE_DUE_TOOL,
      `Propose moving a planner task's due date, with the reason, which is kept in the task's history. To change anything else about a task use the task update tool. ${NOTE}`,
      proposeStudyTaskMoveDueSchema,
    ),
    toolDef(
      STUDY_TASK_SHARE_TOOL,
      `Propose showing a planner task on the client portal, or hiding it again. ${NOTE}`,
      proposeStudyTaskShareSchema,
    ),
    toolDef(
      STUDY_DEPENDENCY_ADD_TOOL,
      `Propose making one planner task wait for another. ${NOTE}`,
      proposeStudyDependencyAddSchema,
    ),
    toolDef(
      STUDY_DEPENDENCY_REMOVE_TOOL,
      `Propose removing the dependency between two planner tasks. ${NOTE}`,
      proposeStudyDependencyRemoveSchema,
    ),
    toolDef(
      STUDY_TASK_BOOK_TOOL,
      `Propose reserving an instrument or room for a planner task between two times. ${NOTE}`,
      proposeStudyTaskBookSchema,
    ),
    toolDef(
      STUDY_DELIVERABLE_UPDATE_TOOL,
      `Propose changing a task's deliverable: its name, description, status or due date. ${NOTE}`,
      proposeStudyDeliverableUpdateSchema,
    ),
    toolDef(
      STUDY_DELIVERABLE_REORDER_TOOL,
      `Propose putting a task's deliverables in a new order. ${NOTE}`,
      proposeStudyDeliverableReorderSchema,
    ),
    toolDef(
      STUDY_DELIVERABLE_EVIDENCE_TOOL,
      `Propose attaching the experiment or record that shows a deliverable was met. ${NOTE}`,
      proposeStudyDeliverableEvidenceSchema,
    ),
  ]
}

interface TaskRow {
  id: string
  title: string
  due_at: string | null
  client_visible: boolean
  metadata_version: number
  project_id: string | null
}

const findTask = (
  client: DataClient,
  wanted: string,
): Promise<Lookup<TaskRow>> =>
  find<TaskRow>(client, wanted, {
    table: 'study_tasks',
    match: ['title'],
    select: 'id,title,due_at,client_visible,metadata_version,project_id',
    what: 'planner task',
    order: 'due_at.asc.nullslast',
    label: (row) => row.title,
    names: (row) => [row.title],
  })

interface DeliverableRow {
  id: string
  name: string
  status: string
  due_at: string | null
}

const findDeliverable = (
  client: DataClient,
  taskId: string,
  wanted: string,
): Promise<Lookup<DeliverableRow>> =>
  find<DeliverableRow>(client, wanted, {
    table: 'study_deliverables',
    match: ['name'],
    select: 'id,name,status,due_at',
    what: 'deliverable',
    extra: `&task_id=eq.${encodeURIComponent(taskId)}`,
    label: (row) => row.name,
    names: (row) => [row.name],
  })

const findStudy = (client: DataClient, wanted: string) =>
  findRecordOf(client, wanted, 'study', ['study'])

const taskLink = (task: { project_id: string | null }): string =>
  task.project_id ? `/projects/${task.project_id}/milestones` : '/projects'

const studyLink = (id: string): string => `/records/${id}`

const label = (row: { identifier: string; title: string }): string =>
  `${row.identifier} · ${row.title}`

/** A local date and time the person gave, as the instant it names. */
const instant = (local: string, timeZone: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const date = instantFromLocal(local, timeZone)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function buildStudiesProposal(
  name: StudiesProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const { client } = context

  switch (name) {
    case STUDY_CREATE_TOOL: {
      const parsed = proposeStudyCreateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const home = input.project
        ? await findProject(client, input.project)
        : null

      if (home && !home.ok) return fail(home.message)

      const changes: ProposalChange[] = [
        { label: 'Study', before: null, after: input.study.trim() },
      ]

      if (home?.ok)
        changes.push({
          label: 'Home project',
          before: null,
          after: home.value.title,
        })

      if (input.startsOn)
        changes.push({ label: 'Starts', before: null, after: input.startsOn })

      if (input.endsOn)
        changes.push({ label: 'Ends', before: null, after: input.endsOn })

      return card(name, input, 'New study', null, changes, {
        kind: 'study.create',
        workspaceId: context.workspaceId,
        title: input.study.trim(),
        projectId: home?.ok ? home.value.id : null,
        description: input.description ?? null,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
      })
    }

    case STUDY_EDIT_TOOL: {
      const parsed = proposeStudyEditSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      if (
        !input.name &&
        !input.status &&
        input.description === undefined &&
        !input.startsOn &&
        !input.endsOn
      )
        return fail('Ask the person what to change on the study.')
      const found = await findStudy(client, input.study)

      if (!found.ok) return fail(found.message)
      const study = found.value
      const changes: ProposalChange[] = []

      if (input.name)
        changes.push({
          label: 'Title',
          before: study.title,
          after: input.name.trim(),
        })

      if (input.status)
        changes.push({ label: 'Status', before: null, after: input.status })

      if (input.description !== undefined)
        changes.push({
          label: 'Summary',
          before: null,
          after: input.description,
        })

      if (input.startsOn)
        changes.push({ label: 'Starts', before: null, after: input.startsOn })

      if (input.endsOn)
        changes.push({ label: 'Ends', before: null, after: input.endsOn })

      return card(name, input, label(study), studyLink(study.id), changes, {
        kind: 'study.edit',
        id: study.id,
        metadataVersion: study.metadata_version,
        title: input.name?.trim() ?? null,
        status: input.status ?? null,
        description: input.description ?? null,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
      })
    }

    case STUDY_ADD_EXPERIMENT_TOOL: {
      const parsed = proposeStudyAddExperimentSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const study = await findStudy(client, input.study)

      if (!study.ok) return fail(study.message)

      const experiment = await findRecordOf(
        client,
        input.experiment,
        'experiment',
        ['experiment'],
      )

      if (!experiment.ok) return fail(experiment.message)

      return card(
        name,
        input,
        label(study.value),
        studyLink(study.value.id),
        [
          {
            label: 'Adds experiment',
            before: null,
            after: label(experiment.value),
          },
        ],
        {
          kind: 'study.add_experiment',
          studyId: study.value.id,
          experimentId: experiment.value.id,
          relationship: input.relationship ?? null,
        },
      )
    }

    case STUDY_ADD_PROJECT_TOOL: {
      const parsed = proposeStudyAddProjectSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const study = await findStudy(client, input.study)

      if (!study.ok) return fail(study.message)
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)

      return card(
        name,
        input,
        label(study.value),
        studyLink(study.value.id),
        [{ label: 'Adds project', before: null, after: project.value.title }],
        {
          kind: 'study.add_project',
          studyId: study.value.id,
          projectId: project.value.id,
          relationship: input.relationship ?? null,
        },
      )
    }

    case STUDY_PLAN_SNAPSHOT_TOOL: {
      const parsed = proposeStudyPlanSnapshotSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const study = await findStudy(client, input.study)

      if (!study.ok) return fail(study.message)

      return card(
        name,
        input,
        label(study.value),
        studyLink(study.value.id),
        [
          {
            label: 'Keeps',
            before: null,
            after: input.reason
              ? `The plan as it stands (${input.reason})`
              : 'The plan as it stands',
          },
        ],
        {
          kind: 'study.plan_snapshot',
          studyId: study.value.id,
          reason: input.reason ?? null,
        },
      )
    }

    case STUDY_WORKSTREAM_ADD_TOOL: {
      const parsed = proposeStudyWorkstreamAddSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const project = input.project
        ? await findProject(client, input.project)
        : null

      if (project && !project.ok) return fail(project.message)

      const changes: ProposalChange[] = [
        { label: 'Workstream', before: null, after: input.name.trim() },
      ]

      if (project?.ok)
        changes.push({
          label: 'Project',
          before: null,
          after: project.value.title,
        })

      return card(
        name,
        input,
        'Planner',
        project?.ok ? taskLink({ project_id: project.value.id }) : '/projects',
        changes,
        {
          kind: 'study.workstream_add',
          workspaceId: context.workspaceId,
          name: input.name.trim(),
          projectId: project?.ok ? project.value.id : null,
          color: input.color ?? null,
        },
      )
    }

    case STUDY_TASK_MOVE_DUE_TOOL: {
      const parsed = proposeStudyTaskMoveDueSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findTask(client, input.task)

      if (!found.ok) return fail(found.message)
      const task = found.value

      return card(
        name,
        input,
        `${task.title} · Planner`,
        taskLink(task),
        [
          {
            label: 'Due',
            before: dayText(task.due_at),
            after: input.dueOn ?? 'None',
          },
          { label: 'Reason', before: null, after: input.reason },
        ],
        {
          kind: 'study.task_move_due',
          taskId: task.id,
          metadataVersion: task.metadata_version,
          dueAt: input.dueOn ? atNoon(input.dueOn) : null,
          reason: input.reason,
          notifyClient: input.notifyClient ?? false,
        },
      )
    }

    case STUDY_TASK_SHARE_TOOL: {
      const parsed = proposeStudyTaskShareSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findTask(client, input.task)

      if (!found.ok) return fail(found.message)
      const task = found.value

      return card(
        name,
        input,
        `${task.title} · Planner`,
        taskLink(task),
        [
          {
            label: 'Client portal',
            before: task.client_visible ? 'Shared' : 'Not shared',
            after: input.visible ? 'Shared' : 'Not shared',
          },
        ],
        {
          kind: 'study.task_share',
          taskId: task.id,
          metadataVersion: task.metadata_version,
          visible: input.visible,
          reason: input.reason ?? null,
        },
      )
    }

    case STUDY_DEPENDENCY_ADD_TOOL: {
      const parsed = proposeStudyDependencyAddSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const before = await findTask(client, input.before)

      if (!before.ok) return fail(before.message)
      const after = await findTask(client, input.after)

      if (!after.ok) return fail(after.message)

      if (before.value.id === after.value.id)
        return fail('A task cannot wait for itself; name two different tasks.')

      return card(
        name,
        input,
        `${after.value.title} · Planner`,
        taskLink(after.value),
        [
          {
            label: 'Waits for',
            before: null,
            after: `${before.value.title} (${(input.type ?? 'finish_to_start').replaceAll('_', ' ')}${input.lagDays ? `, ${input.lagDays} days later` : ''})`,
          },
        ],
        {
          kind: 'study.dependency_add',
          workspaceId: context.workspaceId,
          predecessorId: before.value.id,
          successorId: after.value.id,
          dependencyType: input.type ?? 'finish_to_start',
          lagDays: input.lagDays ?? 0,
        },
      )
    }

    case STUDY_DEPENDENCY_REMOVE_TOOL: {
      const parsed = proposeStudyDependencyRemoveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const before = await findTask(client, input.before)

      if (!before.ok) return fail(before.message)
      const after = await findTask(client, input.after)

      if (!after.ok) return fail(after.message)

      const links = await client.list<{ id: string }>(
        'study_task_dependencies',
        `?predecessor_id=eq.${encodeURIComponent(before.value.id)}&successor_id=eq.${encodeURIComponent(after.value.id)}&select=id&limit=1`,
      )

      if (links.length === 0)
        return fail(
          `${after.value.title} does not wait for ${before.value.title}, so there is nothing to remove.`,
        )

      return card(
        name,
        input,
        `${after.value.title} · Planner`,
        taskLink(after.value),
        [
          {
            label: 'No longer waits for',
            before: before.value.title,
            after: 'Nothing',
          },
        ],
        { kind: 'study.dependency_remove', dependencyId: links[0].id },
      )
    }

    case STUDY_TASK_BOOK_TOOL: {
      const parsed = proposeStudyTaskBookSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findTask(client, input.task)

      if (!found.ok) return fail(found.message)

      const starts = instant(input.startsAt, context.timeZone)
      const ends = instant(input.endsAt, context.timeZone)

      if (!starts || !ends || starts >= ends)
        return fail(
          'The times need to be YYYY-MM-DDTHH:MM, and the end after the start.',
        )

      const resource = await find<{ id: string; name: string; code: string }>(
        client,
        input.resource,
        {
          table: 'calendar_resources',
          match: ['name', 'code'],
          select: 'id,name,code',
          what: 'instrument or room',
          extra: '&status=eq.active',
          label: (row) => `${row.name} (${row.code})`,
          names: (row) => [row.name, row.code],
        },
      )

      if (!resource.ok) return fail(resource.message)

      return card(
        name,
        input,
        `${found.value.title} · Planner`,
        taskLink(found.value),
        [
          { label: 'Books', before: null, after: resource.value.name },
          {
            label: 'From',
            before: null,
            after: input.startsAt.replace('T', ' '),
          },
          { label: 'To', before: null, after: input.endsAt.replace('T', ' ') },
        ],
        {
          kind: 'study.task_book',
          workspaceId: context.workspaceId,
          taskId: found.value.id,
          resourceId: resource.value.id,
          startsAt: starts,
          endsAt: ends,
          notes: input.notes ?? null,
        },
      )
    }

    case STUDY_DELIVERABLE_UPDATE_TOOL: {
      const parsed = proposeStudyDeliverableUpdateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      if (
        !input.name &&
        input.description === undefined &&
        !input.status &&
        !input.dueOn
      )
        return fail('Ask the person what to change on the deliverable.')
      const task = await findTask(client, input.task)

      if (!task.ok) return fail(task.message)

      const found = await findDeliverable(
        client,
        task.value.id,
        input.deliverable,
      )

      if (!found.ok) return fail(found.message)
      const row = found.value
      const changes: ProposalChange[] = []

      if (input.name)
        changes.push({
          label: 'Name',
          before: row.name,
          after: input.name.trim(),
        })

      if (input.status)
        changes.push({
          label: 'Status',
          before: row.status,
          after: input.status,
        })

      if (input.dueOn)
        changes.push({
          label: 'Due',
          before: dayText(row.due_at),
          after: input.dueOn,
        })

      if (input.description !== undefined)
        changes.push({
          label: 'Description',
          before: null,
          after: input.description,
        })

      return card(
        name,
        input,
        `${row.name} · ${task.value.title}`,
        taskLink(task.value),
        changes,
        {
          kind: 'study.deliverable_update',
          id: row.id,
          name: input.name?.trim() ?? null,
          description: input.description ?? null,
          status: input.status ?? null,
          dueAt: input.dueOn ? atNoon(input.dueOn) : null,
        },
      )
    }

    case STUDY_DELIVERABLE_REORDER_TOOL: {
      const parsed = proposeStudyDeliverableReorderSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const task = await findTask(client, input.task)

      if (!task.ok) return fail(task.message)

      const rows = await client.list<DeliverableRow>(
        'study_deliverables',
        `?task_id=eq.${encodeURIComponent(task.value.id)}&select=id,name,status,due_at&order=position.asc`,
      )

      const ids: string[] = []

      for (const wanted of input.order) {
        const lower = wanted.trim().toLowerCase()

        const matches = rows.filter(
          (row) =>
            row.name.toLowerCase() === lower ||
            (!ids.includes(row.id) && row.name.toLowerCase().includes(lower)),
        )

        const exact = matches.filter((row) => row.name.toLowerCase() === lower)

        const chosen =
          exact.length === 1
            ? exact[0]
            : matches.length === 1
              ? matches[0]
              : null

        if (!chosen)
          return fail(
            matches.length === 0
              ? `No deliverable of ${task.value.title} matches "${wanted}".`
              : `More than one deliverable matches "${wanted}": ${matches.map((row) => row.name).join(', ')}. Ask which.`,
          )

        if (ids.includes(chosen.id))
          return fail(`"${wanted}" is named twice; name each deliverable once.`)
        ids.push(chosen.id)
      }

      if (ids.length !== rows.length)
        return fail(
          `${task.value.title} has ${rows.length} deliverables (${rows.map((row) => row.name).join(', ')}); name all of them in the order wanted.`,
        )

      return card(
        name,
        input,
        `${task.value.title} · Planner`,
        taskLink(task.value),
        [
          {
            label: 'Order',
            before: rows.map((row) => row.name).join(' → '),
            after: ids
              .map((id) => rows.find((row) => row.id === id)?.name ?? '')
              .join(' → '),
          },
        ],
        { kind: 'study.deliverable_reorder', taskId: task.value.id, ids },
      )
    }

    case STUDY_DELIVERABLE_EVIDENCE_TOOL: {
      const parsed = proposeStudyDeliverableEvidenceSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const task = await findTask(client, input.task)

      if (!task.ok) return fail(task.message)

      const found = await findDeliverable(
        client,
        task.value.id,
        input.deliverable,
      )

      if (!found.ok) return fail(found.message)

      const record = await find<{
        id: string
        identifier: string
        title: string
      }>(client, input.record, {
        table: 'records',
        match: ['identifier', 'title'],
        select: 'id,identifier,title',
        what: 'record',
        extra: '&deleted_at=is.null',
        order: 'identifier.asc',
        label,
        names: (row) => [row.identifier, row.title],
      })

      if (!record.ok) return fail(record.message)

      return card(
        name,
        input,
        `${found.value.name} · ${task.value.title}`,
        taskLink(task.value),
        [{ label: 'Evidence', before: null, after: label(record.value) }],
        {
          kind: 'study.deliverable_evidence',
          id: found.value.id,
          recordId: record.value.id,
        },
      )
    }
  }
}
