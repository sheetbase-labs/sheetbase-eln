import {
  PIPELINES_PROPOSE_TOOL_NAMES,
  PIPELINE_CANCEL_TOOL,
  PIPELINE_PUBLISH_TOOL,
  PIPELINE_RETIRE_TOOL,
  PIPELINE_RETRY_TOOL,
  PIPELINE_RUN_TOOL,
  PIPELINE_SCHEDULE_ADD_TOOL,
  PIPELINE_SCHEDULE_DELETE_TOOL,
  PIPELINE_SCHEDULE_SWITCH_TOOL,
  PLUGIN_REMOVE_TOOL,
  PLUGIN_SWITCH_TOOL,
  proposePipelineCancelSchema,
  proposePipelinePublishSchema,
  proposePipelineRetireSchema,
  proposePipelineRetrySchema,
  proposePipelineRunSchema,
  proposePipelineScheduleAddSchema,
  proposePipelineScheduleDeleteSchema,
  proposePipelineScheduleSwitchSchema,
  proposePluginRemoveSchema,
  proposePluginSwitchSchema,
} from './assistant-pipelines'
import type {
  PipelinesAction,
  PipelinesProposeToolName,
} from './assistant-pipelines'
import { invalid, likeValue, toolDef } from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import { pick } from './assistant-upkeep.server'
import type { Lookup } from './assistant-upkeep.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { ProviderToolDef } from './ai-providers/types'
import {
  normalizeTriggerEventName,
  validateScheduleSpec,
} from './pipeline-schedule'

/**
 * Cards for pipelines and plugins (see `assistant-pipelines.ts`). Each builder
 * finds what the person named under their own access, checks what it can, and
 * returns a card saying exactly what will happen. Nothing is written here.
 */

export type PipelinesOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isPipelinesProposalTool(
  name: string,
): name is PipelinesProposeToolName {
  return (PIPELINES_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
}

export function pipelinesProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PIPELINE_RUN_TOOL,
      `Propose running a pipeline on its newest published version, with the dataset each input reads (its newest version) and any settings they gave. List the pipelines area first for the name. ${NOTE}`,
      proposePipelineRunSchema,
    ),
    toolDef(
      PIPELINE_RETRY_TOOL,
      `Propose running a pipeline’s newest failed or cancelled run again, on the same version with the same inputs. ${NOTE}`,
      proposePipelineRetrySchema,
    ),
    toolDef(
      PIPELINE_CANCEL_TOOL,
      `Propose cancelling a pipeline’s run that is going now. ${NOTE}`,
      proposePipelineCancelSchema,
    ),
    toolDef(
      PIPELINE_PUBLISH_TOOL,
      `Propose publishing a pipeline’s newest draft, so runs and schedules use it from then on. Only stewards, admins and owners can. ${NOTE}`,
      proposePipelinePublishSchema,
    ),
    toolDef(
      PIPELINE_RETIRE_TOOL,
      `Propose retiring a pipeline so it can no longer run, or bringing a retired one back. ${NOTE}`,
      proposePipelineRetireSchema,
    ),
    toolDef(
      PIPELINE_SCHEDULE_ADD_TOOL,
      `Propose making a pipeline run by itself: every so many minutes, daily at a time, on a cron, or whenever an event happens. Give exactly one of everyMinutes, dailyAt, cron and onEvent. ${NOTE}`,
      proposePipelineScheduleAddSchema,
    ),
    toolDef(
      PIPELINE_SCHEDULE_SWITCH_TOOL,
      `Propose switching one of a pipeline’s schedules off (paused) or back on. List the pipeline_schedules area first if it has several. ${NOTE}`,
      proposePipelineScheduleSwitchSchema,
    ),
    toolDef(
      PIPELINE_SCHEDULE_DELETE_TOOL,
      `Propose deleting one of a pipeline’s schedules. Runs it already started stay. Only propose it when the person clearly asked. ${NOTE}`,
      proposePipelineScheduleDeleteSchema,
    ),
    toolDef(
      PLUGIN_SWITCH_TOOL,
      `Propose switching an installed plugin on or off. Only owners and admins can. List the plugins area first for the name. ${NOTE}`,
      proposePluginSwitchSchema,
    ),
    toolDef(
      PLUGIN_REMOVE_TOOL,
      `Propose removing an installed plugin. Everything it adds stops at once. Only owners and admins can, and only propose it when the person clearly asked. ${NOTE}`,
      proposePluginRemoveSchema,
    ),
  ]
}

const fail = (message: string): PipelinesOutcome => ({ ok: false, message })

interface PipelineRow {
  id: string
  key: string
  name: string
  lifecycle: string
}

interface VersionRow {
  id: string
  version: number
  lifecycle: string
  configuration: {
    inputs?: { name: string; required?: boolean }[]
  } | null
}

interface RunRow {
  id: string
  status: string
  attempt: number
  started_at: string
  error_message: string | null
}

interface ScheduleRow {
  id: string
  kind: string
  spec: Record<string, unknown>
  enabled: boolean
}

interface PluginRow {
  id: string
  key: string
  name: string
  version: string
  status: string
}

async function findPipeline(
  context: LabToolContext,
  text: string,
): Promise<Lookup<PipelineRow>> {
  const like = likeValue(text)

  const rows = await context.client.list<PipelineRow>(
    'pipeline_definitions',
    `?or=(name.ilike.${like},key.ilike.${like})&select=id,key,name,lifecycle&order=name.asc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'pipeline',
    (row) => row.name,
    (row) =>
      row.name.toLowerCase() === lower || row.key.toLowerCase() === lower,
  )
}

async function versions(
  context: LabToolContext,
  definitionId: string,
  lifecycle: 'published' | 'draft',
): Promise<VersionRow[]> {
  return context.client.list<VersionRow>(
    'pipeline_definition_versions',
    `?definition_id=eq.${encodeURIComponent(definitionId)}&lifecycle=eq.${lifecycle}&select=id,version,lifecycle,configuration&order=version.desc&limit=1`,
  )
}

/** The pipeline's runs with these statuses, newest first. */
async function runs(
  context: LabToolContext,
  definitionId: string,
  statuses: readonly string[],
): Promise<RunRow[]> {
  const all = await context.client.list<{ id: string }>(
    'pipeline_definition_versions',
    `?definition_id=eq.${encodeURIComponent(definitionId)}&select=id&limit=500`,
  )

  if (all.length === 0) return []

  return context.client.list<RunRow>(
    'pipeline_runs',
    `?definition_version_id=in.(${all.map((v) => v.id).join(',')})&status=in.(${statuses.join(',')})&select=id,status,attempt,started_at,error_message&order=started_at.desc&limit=1`,
  )
}

async function findSchedule(
  context: LabToolContext,
  definitionId: string,
  pipelineName: string,
  kind: string | undefined,
): Promise<Lookup<ScheduleRow>> {
  const rows = await context.client.list<ScheduleRow>(
    'pipeline_schedules',
    `?definition_id=eq.${encodeURIComponent(definitionId)}${kind ? `&kind=eq.${kind}` : ''}&select=id,kind,spec,enabled&order=created_at.asc&limit=20`,
  )

  if (rows.length === 1) return { ok: true, value: rows[0] }

  if (rows.length === 0)
    return {
      ok: false,
      message: `${pipelineName} has no ${kind ? `${kind} ` : ''}schedule.`,
    }

  return {
    ok: false,
    message: `${pipelineName} has ${rows.length} schedules: ${rows.map(describeSchedule).join('; ')}. Ask the person which one, and pass its kind.`,
  }
}

async function findPlugin(
  context: LabToolContext,
  text: string,
): Promise<Lookup<PluginRow>> {
  const like = likeValue(text)

  const rows = await context.client.list<PluginRow>(
    'extensions',
    `?or=(name.ilike.${like},key.ilike.${like})&select=id,key,name,version,status&order=name.asc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'plugin',
    (row) => row.name,
    (row) =>
      row.name.toLowerCase() === lower || row.key.toLowerCase() === lower,
  )
}

/** "every 60 minutes", "daily at 06:00", "on dataset.versioned". */
export function describeSchedule(schedule: {
  kind: string
  spec: Record<string, unknown>
  enabled?: boolean
}): string {
  const { spec } = schedule

  const when =
    schedule.kind === 'interval'
      ? `every ${String(spec.intervalMinutes)} minutes`
      : schedule.kind === 'daily'
        ? `daily at ${String(spec.dailyAt)}`
        : schedule.kind === 'cron'
          ? `on the cron ${String(spec.cron)}`
          : `when ${String(spec.eventType)} happens`

  return schedule.enabled === false ? `${when} (off)` : when
}

const pipelineLink = (definitionId: string) => `/pipelines/${definitionId}`

function card(
  name: PipelinesProposeToolName,
  input: { title: string; summary: string },
  target: string,
  deepLink: string | null,
  changes: ProposalChange[],
  action: PipelinesAction,
): PipelinesOutcome {
  return {
    ok: true,
    proposal: {
      tool: name,
      title: input.title,
      summary: input.summary,
      target,
      deepLink,
      changes,
      action,
    },
  }
}

export async function buildPipelinesProposal(
  name: PipelinesProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<PipelinesOutcome> {
  switch (name) {
    case PIPELINE_RUN_TOOL: {
      const parsed = proposePipelineRunSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findPipeline(context, input.pipeline)

      if (!found.ok) return fail(found.message)
      const pipeline = found.value

      if (pipeline.lifecycle !== 'active')
        return fail(`${pipeline.name} is retired, so it cannot run.`)
      const version = (await versions(context, pipeline.id, 'published')).at(0)

      if (!version)
        return fail(
          `${pipeline.name} has no published version yet; publish its draft first.`,
        )
      const declared = version.configuration?.inputs ?? []
      const given = input.inputs ?? {}

      const unknown = Object.keys(given).filter(
        (key) => !declared.some((d) => d.name === key),
      )

      if (unknown.length > 0)
        return fail(
          `${pipeline.name} has no input called ${unknown.join(', ')}. Its inputs are: ${declared.map((d) => d.name).join(', ') || 'none'}.`,
        )

      const missing = declared.filter(
        (d) => d.required !== false && !(d.name in given),
      )

      if (missing.length > 0)
        return fail(
          `Ask the person which dataset ${missing.map((d) => d.name).join(' and ')} should read.`,
        )
      const inputVersions: Record<string, string> = {}

      const changes: ProposalChange[] = [
        { label: 'Version', before: null, after: `v${version.version}` },
      ]

      for (const [inputName, datasetName] of Object.entries(given)) {
        const like = likeValue(datasetName)

        const datasets = await context.client.list<{
          id: string
          name: string
        }>('datasets', `?name=ilike.${like}&select=id,name&limit=6`)

        const lower = datasetName.trim().toLowerCase()

        const dataset = pick(
          datasets,
          datasetName,
          'dataset',
          (row) => row.name,
          (row) => row.name.toLowerCase() === lower,
        )

        if (!dataset.ok) return fail(dataset.message)

        const latest = (
          await context.client.list<{
            id: string
            label: string
          }>(
            'dataset_versions',
            `?dataset_id=eq.${encodeURIComponent(dataset.value.id)}&select=id,label&order=created_at.desc&limit=1`,
          )
        ).at(0)

        if (!latest)
          return fail(`${dataset.value.name} has no saved version to read.`)
        inputVersions[inputName] = latest.id
        changes.push({
          label: inputName,
          before: null,
          after: `${dataset.value.name} (${latest.label})`,
        })
      }

      const parameters = input.parameters ?? {}

      for (const [key, value] of Object.entries(parameters))
        changes.push({ label: key, before: null, after: JSON.stringify(value) })

      return card(
        name,
        input,
        `${pipeline.name} · Pipelines`,
        pipelineLink(pipeline.id),
        changes,
        {
          kind: 'pipeline.run',
          definitionId: pipeline.id,
          versionId: version.id,
          parameters,
          inputVersions,
        },
      )
    }

    case PIPELINE_RETRY_TOOL: {
      const parsed = proposePipelineRetrySchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findPipeline(context, input.pipeline)

      if (!found.ok) return fail(found.message)
      const pipeline = found.value

      const run = (
        await runs(context, pipeline.id, ['failed', 'cancelled'])
      ).at(0)

      if (!run)
        return fail(`${pipeline.name} has no failed or cancelled run to retry.`)

      return card(
        name,
        input,
        `${pipeline.name} · Pipelines`,
        `${pipelineLink(pipeline.id)}/runs/${run.id}`,
        [
          {
            label: 'Run',
            before: `${run.status}, attempt ${run.attempt}`,
            after: `attempt ${run.attempt + 1}`,
          },
          ...(run.error_message
            ? [{ label: 'Last error', before: null, after: run.error_message }]
            : []),
        ],
        { kind: 'pipeline.retry', definitionId: pipeline.id, runId: run.id },
      )
    }

    case PIPELINE_CANCEL_TOOL: {
      const parsed = proposePipelineCancelSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findPipeline(context, input.pipeline)

      if (!found.ok) return fail(found.message)
      const pipeline = found.value
      const run = (await runs(context, pipeline.id, ['running'])).at(0)

      if (!run) return fail(`${pipeline.name} has no run going now.`)

      return card(
        name,
        input,
        `${pipeline.name} · Pipelines`,
        `${pipelineLink(pipeline.id)}/runs/${run.id}`,
        [{ label: 'Run', before: 'running', after: 'cancelled' }],
        {
          kind: 'pipeline.cancel',
          workspaceId: context.workspaceId,
          definitionId: pipeline.id,
          runId: run.id,
        },
      )
    }

    case PIPELINE_PUBLISH_TOOL: {
      const parsed = proposePipelinePublishSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findPipeline(context, input.pipeline)

      if (!found.ok) return fail(found.message)
      const pipeline = found.value
      const draft = (await versions(context, pipeline.id, 'draft')).at(0)

      if (!draft) return fail(`${pipeline.name} has no draft to publish.`)
      const current = (await versions(context, pipeline.id, 'published')).at(0)

      return card(
        name,
        input,
        `${pipeline.name} · Pipelines`,
        `${pipelineLink(pipeline.id)}/steps`,
        [
          {
            label: 'Published version',
            before: current ? `v${current.version}` : null,
            after: `v${draft.version}`,
          },
        ],
        {
          kind: 'pipeline.publish',
          workspaceId: context.workspaceId,
          definitionId: pipeline.id,
          versionId: draft.id,
        },
      )
    }

    case PIPELINE_RETIRE_TOOL: {
      const parsed = proposePipelineRetireSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findPipeline(context, input.pipeline)

      if (!found.ok) return fail(found.message)
      const pipeline = found.value
      const lifecycle = input.retire ? 'retired' : 'active'

      if (pipeline.lifecycle === lifecycle)
        return fail(`${pipeline.name} is already ${lifecycle}.`)

      return card(
        name,
        input,
        `${pipeline.name} · Pipelines`,
        pipelineLink(pipeline.id),
        [{ label: 'Pipeline', before: pipeline.lifecycle, after: lifecycle }],
        {
          kind: 'pipeline.retire',
          workspaceId: context.workspaceId,
          definitionId: pipeline.id,
          lifecycle,
        },
      )
    }

    case PIPELINE_SCHEDULE_ADD_TOOL: {
      const parsed = proposePipelineScheduleAddSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const given = [
        input.everyMinutes,
        input.dailyAt,
        input.cron,
        input.onEvent,
      ].filter((value) => value !== undefined)

      if (given.length !== 1)
        return fail(
          'Give exactly one of everyMinutes, dailyAt, cron and onEvent.',
        )
      let scheduleKind: 'interval' | 'daily' | 'cron' | 'event'
      let spec: Record<string, unknown>

      if (input.everyMinutes !== undefined) {
        scheduleKind = 'interval'
        spec = { intervalMinutes: input.everyMinutes }
      } else if (input.dailyAt !== undefined) {
        scheduleKind = 'daily'
        spec = { dailyAt: input.dailyAt, timeZone: context.timeZone }
      } else if (input.cron !== undefined) {
        scheduleKind = 'cron'
        spec = { cron: input.cron, timeZone: context.timeZone }
      } else {
        scheduleKind = 'event'
        const eventType = normalizeTriggerEventName(input.onEvent)

        if (!eventType)
          return fail(
            `${String(input.onEvent)} is not an event that can start a pipeline.`,
          )
        spec = { eventType }
      }

      const problem = validateScheduleSpec(scheduleKind, spec)

      if (problem) return fail(problem.message)
      const found = await findPipeline(context, input.pipeline)

      if (!found.ok) return fail(found.message)
      const pipeline = found.value

      return card(
        name,
        input,
        `${pipeline.name} · Triggers`,
        `${pipelineLink(pipeline.id)}/triggers`,
        [
          {
            label: 'Runs',
            before: null,
            after: describeSchedule({ kind: scheduleKind, spec }),
          },
        ],
        {
          kind: 'pipeline.schedule_add',
          workspaceId: context.workspaceId,
          definitionId: pipeline.id,
          scheduleKind,
          spec,
        },
      )
    }

    case PIPELINE_SCHEDULE_SWITCH_TOOL:
    case PIPELINE_SCHEDULE_DELETE_TOOL: {
      const switching = name === PIPELINE_SCHEDULE_SWITCH_TOOL

      const parsed = switching
        ? proposePipelineScheduleSwitchSchema.safeParse(args)
        : proposePipelineScheduleDeleteSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findPipeline(context, input.pipeline)

      if (!found.ok) return fail(found.message)
      const pipeline = found.value

      const schedule = await findSchedule(
        context,
        pipeline.id,
        pipeline.name,
        input.kind,
      )

      if (!schedule.ok) return fail(schedule.message)
      const target = `${pipeline.name} · Triggers`
      const link = `${pipelineLink(pipeline.id)}/triggers`

      if (!switching)
        return card(
          name,
          input,
          target,
          link,
          [
            {
              label: 'Schedule',
              before: describeSchedule(schedule.value),
              after: 'deleted',
            },
          ],
          {
            kind: 'pipeline.schedule_delete',
            workspaceId: context.workspaceId,
            definitionId: pipeline.id,
            scheduleId: schedule.value.id,
          },
        )
      const on = 'on' in input && input.on === true

      if (schedule.value.enabled === on)
        return fail(`That schedule is already ${on ? 'on' : 'off'}.`)

      return card(
        name,
        input,
        target,
        link,
        [
          {
            label: describeSchedule({ ...schedule.value, enabled: true }),
            before: schedule.value.enabled ? 'on' : 'off',
            after: on ? 'on' : 'off',
          },
        ],
        {
          kind: 'pipeline.schedule_switch',
          workspaceId: context.workspaceId,
          definitionId: pipeline.id,
          scheduleId: schedule.value.id,
          enabled: on,
        },
      )
    }

    case PLUGIN_SWITCH_TOOL: {
      const parsed = proposePluginSwitchSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findPlugin(context, input.plugin)

      if (!found.ok) return fail(found.message)
      const plugin = found.value
      const isOn = plugin.status === 'enabled'

      if (isOn === input.on)
        return fail(`${plugin.name} is already ${isOn ? 'on' : 'off'}.`)

      return card(
        name,
        input,
        `${plugin.name} · Plugins`,
        '/settings/workspace/plugins',
        [
          {
            label: `${plugin.name} ${plugin.version}`,
            before: isOn ? 'on' : 'off',
            after: input.on ? 'on' : 'off',
          },
        ],
        {
          kind: 'plugin.switch',
          workspaceId: context.workspaceId,
          extensionId: plugin.id,
          enabled: input.on,
        },
      )
    }

    case PLUGIN_REMOVE_TOOL: {
      const parsed = proposePluginRemoveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findPlugin(context, input.plugin)

      if (!found.ok) return fail(found.message)
      const plugin = found.value

      return card(
        name,
        input,
        `${plugin.name} · Plugins`,
        '/settings/workspace/plugins',
        [
          {
            label: 'Plugin',
            before: `${plugin.name} ${plugin.version}`,
            after: 'removed',
          },
        ],
        {
          kind: 'plugin.remove',
          workspaceId: context.workspaceId,
          extensionId: plugin.id,
        },
      )
    }
  }
}
