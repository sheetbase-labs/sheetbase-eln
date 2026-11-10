import {
  AUTOMATION_PROPOSE_TOOL_NAMES,
  ROBOT_SEND_TOOL,
  SCHEDULE_ACCEPT_TOOL,
  SCHEDULE_PLAN_TOOL,
  proposeRobotSendSchema,
  proposeScheduleAcceptSchema,
  proposeSchedulePlanSchema,
} from './assistant-automation'
import type { AutomationProposeToolName } from './assistant-automation'
import {
  invalid,
  likeValue,
  resolveInstrument,
  toolDef,
} from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import { pick } from './assistant-upkeep.server'
import type { Lookup } from './assistant-upkeep.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { ProviderToolDef } from './ai-providers/types'
import { worklistReference } from './plate-runs'
import { proposalReference } from './scheduler'
import type { ScheduleProposalWire } from './scheduler'

/**
 * Cards for robots and the scheduler (see `assistant-automation.ts`). Each
 * builder finds what the person named under their own access, checks what it
 * can and returns a card saying exactly what will change. Nothing is written
 * here.
 */

export type AutomationOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isAutomationProposalTool(
  name: string,
): name is AutomationProposeToolName {
  return AUTOMATION_PROPOSE_TOOL_NAMES.some((tool) => tool === name)
}

export function automationProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      ROBOT_SEND_TOOL,
      `Propose sending a planned worklist to a robot. The agent next to the robot puts the run on it; a person then presses Start in Sheetbase at the robot, and what it did is read back as the worklist's transfers and the stock used. You cannot start a job. ${NOTE}`,
      proposeRobotSendSchema,
    ),
    toolDef(
      SCHEDULE_PLAN_TOOL,
      `Propose asking for a schedule for the parts of an experiment: instruments and people, inside working hours, around absences, booking rules and the waits between parts. It is a proposal; nothing is booked until the person accepts it. ${NOTE}`,
      proposeSchedulePlanSchema,
    ),
    toolDef(
      SCHEDULE_ACCEPT_TOOL,
      `Propose accepting the latest proposed schedule of an experiment, which books its instrument slots and moves its parts to the days planned. Slots that cannot be booked are listed afterwards. ${NOTE}`,
      proposeScheduleAcceptSchema,
    ),
  ]
}

const fail = (message: string): AutomationOutcome => ({ ok: false, message })

interface WorklistRow {
  id: string
  number: number
  name: string
  status: string
  format: string
  record_id: string | null
}

interface ExperimentRow {
  id: string
  identifier: string
  title: string
}

async function findWorklist(
  context: LabToolContext,
  text: string,
): Promise<Lookup<WorklistRow>> {
  const number = /^wl-?0*(\d+)$/i.exec(text.trim())?.[1]

  const filter = number
    ? `number=eq.${number}`
    : `name=ilike.${likeValue(text)}`

  const rows = await context.client.list<WorklistRow>(
    'plate_worklists',
    `?${filter}&status=eq.planned&select=id,number,name,status,format,record_id&order=number.desc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'planned worklist',
    (row) => `${worklistReference(row.number)} ${row.name}`,
    (row) =>
      row.name.toLowerCase() === lower ||
      worklistReference(row.number).toLowerCase() === lower,
  )
}

async function findExperiment(
  context: LabToolContext,
  text: string,
): Promise<Lookup<ExperimentRow>> {
  const like = likeValue(text)

  const rows = await context.client.list<ExperimentRow>(
    'records',
    `?kind=eq.experiment&deleted_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title&order=updated_at.desc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'experiment',
    (row) => `${row.identifier} · ${row.title}`,
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
}

const experimentLabel = (row: ExperimentRow) =>
  `${row.identifier} · ${row.title}`

async function partCount(
  context: LabToolContext,
  recordId: string,
): Promise<number> {
  const parts = await context.client.list<{ id: string }>(
    'experiment_parts',
    `?record_id=eq.${recordId}&select=id&limit=50`,
  )

  return parts.length
}

export async function buildAutomationProposal(
  name: AutomationProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The assistant's tool call arrives as unparsed JSON; the proposal schema for `name` parses it here and a refusal names the bad field.
  args: unknown,
  context: LabToolContext,
): Promise<AutomationOutcome> {
  switch (name) {
    case ROBOT_SEND_TOOL: {
      const parsed = proposeRobotSendSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const worklist = await findWorklist(context, input.worklist)

      if (!worklist.ok) return fail(worklist.message)

      const robot = await resolveInstrument(
        context.client,
        context.workspaceId,
        input.robot,
      )

      if (!robot.ok) return fail(robot.message)

      const settings = await context.client.list<{
        driver: string
        worklist_format: string
      }>(
        'instrument_robot_settings',
        `?instrument_id=eq.${robot.instrument.id}&select=driver,worklist_format&limit=1`,
      )

      if (!settings[0]) {
        return fail(
          `${robot.instrument.name} is not set up as a robot yet. Say that it can be set up on its instrument page, under Robot, and offer to open it.`,
        )
      }

      const open = await context.client.list<{
        number: number
        status: string
      }>(
        'instrument_jobs',
        `?worklist_id=eq.${worklist.value.id}&status=in.(queued,staged,starting,running)&select=number,status&limit=1`,
      )

      if (open[0]) {
        return fail(
          `${worklistReference(worklist.value.number)} is already on a robot (${open[0].status}).`,
        )
      }

      const note = input.note?.trim() || null

      const changes: ProposalChange[] = [
        {
          label: 'Worklist',
          before: null,
          after: `${worklistReference(worklist.value.number)} · ${worklist.value.name}`,
        },
        { label: 'Robot', before: null, after: robot.instrument.name },
        {
          label: 'Then',
          before: null,
          after: 'Waits on the robot until a person presses Start',
        },
      ]

      if (note) changes.push({ label: 'Note', before: null, after: note })

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${robot.instrument.name} · Robot`,
          deepLink: `/instruments/${robot.instrument.id}`,
          changes,
          action: {
            kind: 'robot.send',
            worklistId: worklist.value.id,
            instrumentId: robot.instrument.id,
            note,
          },
        },
      }
    }

    case SCHEDULE_PLAN_TOOL: {
      const parsed = proposeSchedulePlanSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const found = await findExperiment(context, parsed.data.experiment)

      if (!found.ok) return fail(found.message)
      const parts = await partCount(context, found.value.id)

      if (parts === 0) {
        return fail(
          `${experimentLabel(found.value)} is not split into parts, so there is nothing to schedule.`,
        )
      }

      const needs = await context.client.list<{ id: string }>(
        'part_resource_needs',
        `?part_id=in.(${(
          await context.client.list<{ id: string }>(
            'experiment_parts',
            `?record_id=eq.${found.value.id}&select=id&limit=50`,
          )
        )
          .map((p) => p.id)
          .join(',')})&select=id&limit=1`,
      )

      if (needs.length === 0) {
        return fail(
          `No part of ${experimentLabel(found.value)} says which instrument it needs yet. Say that this is set in the Schedule section of the experiment's Summary, and offer to open it.`,
        )
      }

      return {
        ok: true,
        proposal: {
          tool: name,
          title: parsed.data.title,
          summary: parsed.data.summary,
          target: `${found.value.identifier} · Schedule`,
          deepLink: `/experiments/${found.value.id}/summary`,
          changes: [
            {
              label: 'Experiment',
              before: null,
              after: experimentLabel(found.value),
            },
            { label: 'Parts', before: null, after: String(parts) },
            {
              label: 'Result',
              before: null,
              after: 'A proposed schedule to look over. Nothing is booked yet.',
            },
          ],
          action: { kind: 'schedule.plan', recordId: found.value.id },
        },
      }
    }

    case SCHEDULE_ACCEPT_TOOL: {
      const parsed = proposeScheduleAcceptSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const found = await findExperiment(context, parsed.data.experiment)

      if (!found.ok) return fail(found.message)

      const proposals = await context.client.list<
        Pick<
          ScheduleProposalWire,
          'id' | 'number' | 'items' | 'conflict_count' | 'reason'
        >
      >(
        'schedule_proposals',
        `?record_id=eq.${found.value.id}&status=eq.proposed&select=id,number,items,conflict_count,reason&order=created_at.desc&limit=1`,
      )

      const proposal = proposals.at(0)

      if (!proposal) {
        return fail(
          `${experimentLabel(found.value)} has no proposed schedule waiting. Offer to ask for one first.`,
        )
      }

      const slots = proposal.items.filter(
        (item) => item.kind === 'instrument' && item.startsAt,
      ).length

      const changes: ProposalChange[] = [
        {
          label: 'Experiment',
          before: null,
          after: experimentLabel(found.value),
        },
        {
          label: 'Proposal',
          before: null,
          after: proposalReference(proposal.number),
        },
        {
          label: 'Bookings',
          before: null,
          after: `${slots} instrument slot${slots === 1 ? '' : 's'} booked in your name`,
        },
      ]

      if (proposal.conflict_count > 0) {
        changes.push({
          label: 'Needs a look',
          before: null,
          after: `${proposal.conflict_count} slot${proposal.conflict_count === 1 ? '' : 's'} with something in the way; any that cannot be booked are listed afterwards`,
        })
      }

      return {
        ok: true,
        proposal: {
          tool: name,
          title: parsed.data.title,
          summary: parsed.data.summary,
          target: `${found.value.identifier} · Schedule`,
          deepLink: `/experiments/${found.value.id}/summary`,
          changes,
          action: {
            kind: 'schedule.accept',
            proposalId: proposal.id,
            recordId: found.value.id,
          },
        },
      }
    }
  }
}
