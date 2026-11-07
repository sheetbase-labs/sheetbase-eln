import {
  CAMPAIGN_APPROVE_TOOL,
  CAMPAIGN_RESULTS_TOOL,
  CAMPAIGN_ROUND_TOOL,
  CAMPAIGN_START_TOOL,
  PLANNER_PROPOSE_TOOL_NAMES,
  PLAN_TOOL,
  campaignApproveSchema,
  campaignResultsSchema,
  campaignRoundSchema,
  campaignStartSchema,
  proposePlanSchema,
} from './assistant-planner'
import type { PlannerProposeToolName } from './assistant-planner'
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
import { fetchCampaignModels } from './campaigns/data'
import type { CampaignRoundRow, CampaignRow } from './campaigns/campaign'
import { parsePlanAnswer, plateCounts } from './planner/plan'
import type { PlannerContext } from './planner/plan'

/**
 * Cards for the planner and for campaigns (see `assistant-planner.ts`). Each
 * builder finds what the person named under their own access, checks what it
 * can and returns a card saying exactly what will change. Nothing is written
 * here.
 */

export type PlannerOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isPlannerProposalTool(
  name: string,
): name is PlannerProposeToolName {
  return (PLANNER_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
}

export function plannerProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PLAN_TOOL,
      `Propose a plan for an experiment from a goal: the protocol to start from, its parts, a plate layout, a worklist for a liquid handler, samples to set aside and a request for a schedule. Name protocols, instruments and samples as the person does and use only ones that exist. Plan only what the goal asks for and say in warnings what you assumed. Pressing the button creates all of it together; nothing is booked until the person accepts the schedule. ${NOTE}`,
      proposePlanSchema,
    ),
    toolDef(
      CAMPAIGN_START_TOOL,
      `Propose starting (or resuming) an optimisation campaign: the optimiser works out the first round, which waits for the person to approve it. ${NOTE}`,
      campaignStartSchema,
    ),
    toolDef(
      CAMPAIGN_ROUND_TOOL,
      `Propose asking a running campaign for its next round when none is waiting. ${NOTE}`,
      campaignRoundSchema,
    ),
    toolDef(
      CAMPAIGN_APPROVE_TOOL,
      `Propose approving a campaign round the person has read, which makes the round's experiment, plate and worklist. Only propose it when the person asked to approve; never approve to be helpful. ${NOTE}`,
      campaignApproveSchema,
    ),
    toolDef(
      CAMPAIGN_RESULTS_TOOL,
      `Propose entering the results of a campaign round the person gave you: each condition's value for each objective. When every condition has every result the round is complete and the next is asked for. ${NOTE}`,
      campaignResultsSchema,
    ),
  ]
}

const fail = (message: string): PlannerOutcome => ({ ok: false, message })

interface NamedRecord {
  id: string
  identifier: string
  title: string
}
const label = (row: NamedRecord) => `${row.identifier} · ${row.title}`

async function findRecord(
  context: LabToolContext,
  kind: string,
  text: string,
  what: string,
  extra = '',
): Promise<Lookup<NamedRecord>> {
  const like = likeValue(text)
  const rows = await context.client.list<NamedRecord>(
    'records',
    `?kind=eq.${kind}&deleted_at=is.null${extra}&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title&order=updated_at.desc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    what,
    label,
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
}

interface CampaignFound {
  record: NamedRecord
  campaign: CampaignRow
}

async function findCampaign(
  context: LabToolContext,
  text: string,
): Promise<Lookup<CampaignFound>> {
  const models = await fetchCampaignModels(context.client)
  if (models.length === 0)
    return {
      ok: false,
      message:
        'No record model is ticked as a campaign list yet. Say that it is set up on the Campaigns page, and offer to open it.',
    }
  const like = likeValue(text)
  const kinds = models.map((m) => encodeURIComponent(m.key)).join(',')
  const rows = await context.client.list<NamedRecord>(
    'records',
    `?kind=in.(${kinds})&deleted_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title&order=updated_at.desc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  const found = pick(
    rows,
    text,
    'campaign',
    label,
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
  if (!found.ok) return found
  const campaigns = await context.client.list<CampaignRow>(
    'campaigns',
    `?record_id=eq.${found.value.id}&select=*&limit=1`,
  )
  if (!campaigns[0])
    return {
      ok: false,
      message: `${label(found.value)} has no design yet. Say that factors, objectives and budget are set on its campaign page, and offer to open it.`,
    }
  return { ok: true, value: { record: found.value, campaign: campaigns[0] } }
}

async function findRound(
  context: LabToolContext,
  found: CampaignFound,
  number: number | undefined,
  status: string,
): Promise<Lookup<CampaignRoundRow>> {
  const filter = number ? `number=eq.${number}` : `status=eq.${status}`
  const rounds = await context.client.list<CampaignRoundRow>(
    'campaign_rounds',
    `?campaign_record_id=eq.${found.record.id}&${filter}&select=*&order=number.desc&limit=1`,
  )
  if (!rounds[0])
    return {
      ok: false,
      message: number
        ? `${label(found.record)} has no round ${number}.`
        : `${label(found.record)} has no round waiting (${status}).`,
    }
  if (rounds[0].status !== status)
    return {
      ok: false,
      message: `Round ${rounds[0].number} of ${label(found.record)} is ${rounds[0].status}, not ${status}.`,
    }
  return { ok: true, value: rounds[0] }
}

const campaignTarget = (found: CampaignFound) =>
  `${found.record.identifier} · Campaign`

export async function buildPlannerProposal(
  name: PlannerProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<PlannerOutcome> {
  switch (name) {
    case PLAN_TOOL: {
      const parsed = proposePlanSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const projects = await context.client.list<{
        id: string
        title: string
        key: string
      }>(
        'projects',
        `?archived_at=is.null&or=(title.ilike.${likeValue(input.project)},key.ilike.${likeValue(input.project)})&select=id,title,key&limit=6`,
      )
      const lowerProject = input.project.trim().toLowerCase()
      const project = pick(
        projects,
        input.project,
        'project',
        (p) => p.title,
        (p) =>
          p.title.toLowerCase() === lowerProject ||
          p.key.toLowerCase() === lowerProject,
      )
      if (!project.ok) return fail(project.message)

      // The keys the plan parser reads are positions in these short lists, so
      // the answer is built against exactly what was found.
      const planContext: PlannerContext = {
        protocols: [],
        instruments: [],
        samples: [],
      }
      let protocolKey: string | null = null
      if (input.protocol) {
        const found = await findRecord(
          context,
          'protocol_template',
          input.protocol,
          'protocol',
          '&status=eq.active',
        )
        if (!found.ok) return fail(found.message)
        planContext.protocols.push(found.value)
        protocolKey = 't1'
      }
      const instrumentKeys = new Map<string, string>()
      const partsAnswer = []
      for (const part of input.parts ?? []) {
        const instruments = []
        for (const need of part.instruments ?? []) {
          const robot = await resolveInstrument(
            context.client,
            context.workspaceId,
            need.name,
          )
          if (!robot.ok) return fail(robot.message)
          let key = instrumentKeys.get(robot.instrument.id)
          if (!key) {
            planContext.instruments.push({
              id: robot.instrument.id,
              name: robot.instrument.name,
            })
            key = `i${planContext.instruments.length}`
            instrumentKeys.set(robot.instrument.id, key)
          }
          instruments.push({ key, minutes: need.minutes ?? 30 })
        }
        partsAnswer.push({
          title: part.title,
          day: part.day ?? 0,
          handsOnMinutes: part.handsOnMinutes ?? 30,
          waitMinutes: part.waitMinutes ?? 0,
          ...(part.gate ? { gate: part.gate } : {}),
          instruments,
        })
      }
      const samplesAnswer = []
      for (const wanted of input.samples ?? []) {
        const found = await findRecord(
          context,
          'sample',
          wanted.sample,
          'sample',
        )
        if (!found.ok) return fail(found.message)
        const props = await context.client.list<{
          properties: Record<string, unknown> | null
        }>('records', `?id=eq.${found.value.id}&select=properties&limit=1`)
        const quantity = Number(props[0]?.properties?.['quantity'])
        const unit = props[0]?.properties?.['quantityUnit']
        planContext.samples.push({
          ...found.value,
          quantity: Number.isFinite(quantity) ? quantity : null,
          unit: typeof unit === 'string' && unit ? unit : null,
        })
        samplesAnswer.push({
          key: `s${planContext.samples.length}`,
          quantity: wanted.quantity,
        })
      }

      const plan = parsePlanAnswer(
        JSON.stringify({
          summary: input.summary,
          experimentTitle: input.experimentTitle,
          protocol: protocolKey,
          parts: partsAnswer,
          plate: input.plate ?? null,
          worklist: input.worklist ?? null,
          samples: samplesAnswer,
          schedule: input.schedule ?? false,
          warnings: input.warnings ?? [],
        }),
        input.goal,
        planContext,
      )
      if (!plan)
        return fail(
          'The plan could not be put together from those details. Check the plate, worklist and samples and try again.',
        )

      const counts = plateCounts(plan)
      const changes: ProposalChange[] = [
        { label: 'Experiment', before: null, after: plan.experiment.title },
        {
          label: 'Starts from',
          before: null,
          after: plan.experiment.templateLabel ?? 'A blank experiment',
        },
        {
          label: 'Parts',
          before: null,
          after:
            plan.parts.length > 0
              ? plan.parts
                  .map((p) =>
                    p.gate
                      ? `${p.title} (opens when the part before is done)`
                      : p.title,
                  )
                  .join(', ')
              : 'One piece',
        },
      ]
      if (plan.plate)
        changes.push({
          label: 'Plate',
          before: null,
          after: `${plan.plate.format.replace('_well', '-well')}: ${counts.samples} sample wells, ${counts.controls} control wells`,
        })
      if (plan.worklist)
        changes.push({
          label: 'Worklist',
          before: null,
          after: `${plan.worklist.transfers.length} transfers (${plan.worklist.format})`,
        })
      if (plan.samples.length > 0)
        changes.push({
          label: 'Samples set aside',
          before: null,
          after: String(plan.samples.length),
        })
      changes.push({
        label: 'Schedule',
        before: null,
        after: plan.schedule
          ? 'Asked for on the instruments; nothing is booked until you accept it'
          : 'Not asked for',
      })
      for (const warning of plan.warnings)
        changes.push({ label: 'Check', before: null, after: warning })
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${project.value.title} · Plan`,
          deepLink: '/plans',
          changes,
          action: {
            kind: 'plan.apply',
            projectId: project.value.id,
            goal: input.goal,
            plan,
          },
        },
      }
    }
    case CAMPAIGN_START_TOOL: {
      const parsed = campaignStartSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const found = await findCampaign(context, parsed.data.campaign)
      if (!found.ok) return fail(found.message)
      const { campaign } = found.value
      if (campaign.status === 'active')
        return fail(`${label(found.value.record)} is already running.`)
      if (campaign.status === 'finished')
        return fail(`${label(found.value.record)} has finished.`)
      return {
        ok: true,
        proposal: {
          tool: name,
          title: parsed.data.title,
          summary: parsed.data.summary,
          target: campaignTarget(found.value),
          deepLink: `/campaigns/${found.value.record.id}`,
          changes: [
            {
              label: 'Campaign',
              before: campaign.status,
              after: 'Running',
            },
            {
              label: 'Then',
              before: null,
              after:
                'The optimiser works out the first round, which waits for you to approve it',
            },
          ],
          action: { kind: 'campaign.start', recordId: found.value.record.id },
        },
      }
    }
    case CAMPAIGN_ROUND_TOOL: {
      const parsed = campaignRoundSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const found = await findCampaign(context, parsed.data.campaign)
      if (!found.ok) return fail(found.message)
      if (found.value.campaign.status !== 'active')
        return fail(
          `${label(found.value.record)} is not running, so it cannot be asked for a round. Offer to start it first.`,
        )
      return {
        ok: true,
        proposal: {
          tool: name,
          title: parsed.data.title,
          summary: parsed.data.summary,
          target: campaignTarget(found.value),
          deepLink: `/campaigns/${found.value.record.id}`,
          changes: [
            {
              label: 'Campaign',
              before: null,
              after: label(found.value.record),
            },
            {
              label: 'Result',
              before: null,
              after: 'A new round to read and approve; nothing is made yet',
            },
          ],
          action: { kind: 'campaign.round', recordId: found.value.record.id },
        },
      }
    }
    case CAMPAIGN_APPROVE_TOOL: {
      const parsed = campaignApproveSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const found = await findCampaign(context, parsed.data.campaign)
      if (!found.ok) return fail(found.message)
      const round = await findRound(
        context,
        found.value,
        parsed.data.round,
        'proposed',
      )
      if (!round.ok) return fail(round.message)
      const layout = found.value.campaign.layout
      return {
        ok: true,
        proposal: {
          tool: name,
          title: parsed.data.title,
          summary: parsed.data.summary,
          target: campaignTarget(found.value),
          deepLink: `/campaigns/${found.value.record.id}`,
          changes: [
            {
              label: 'Round',
              before: 'Waiting for you',
              after: `Round ${round.value.number} approved`,
            },
            {
              label: 'Conditions',
              before: null,
              after: String(round.value.trials.length),
            },
            {
              label: 'Makes',
              before: null,
              after: [
                'An experiment in the campaign’s series',
                layout.plateFormat ? 'its plate' : null,
                layout.plateFormat && layout.worklistFormat
                  ? 'a worklist'
                  : null,
              ]
                .filter(Boolean)
                .join(', '),
            },
          ],
          action: {
            kind: 'campaign.approve',
            roundId: round.value.id,
            recordId: found.value.record.id,
          },
        },
      }
    }
    case CAMPAIGN_RESULTS_TOOL: {
      const parsed = campaignResultsSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const found = await findCampaign(context, parsed.data.campaign)
      if (!found.ok) return fail(found.message)
      const round = await findRound(
        context,
        found.value,
        parsed.data.round,
        'approved',
      )
      if (!round.ok) return fail(round.message)
      const objectives = new Map(
        found.value.campaign.objectives.map((o) => [
          o.label.toLowerCase(),
          o.key,
        ]),
      )
      for (const o of found.value.campaign.objectives)
        objectives.set(o.key.toLowerCase(), o.key)
      const trials = new Set(round.value.trials.map((t) => t.trial))
      const results: Array<{ trial: number; results: Record<string, number> }> =
        []
      for (const entry of parsed.data.results) {
        if (!trials.has(entry.condition))
          return fail(
            `Round ${round.value.number} has no condition ${entry.condition}.`,
          )
        const values: Record<string, number> = {}
        for (const v of entry.values) {
          const key = objectives.get(v.objective.trim().toLowerCase())
          if (!key)
            return fail(
              `"${v.objective}" is not an objective of this campaign. Its objectives are ${found.value.campaign.objectives
                .map((o) => o.label)
                .join(', ')}.`,
            )
          values[key] = v.value
        }
        results.push({ trial: entry.condition, results: values })
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title: parsed.data.title,
          summary: parsed.data.summary,
          target: campaignTarget(found.value),
          deepLink: `/campaigns/${found.value.record.id}`,
          changes: [
            {
              label: 'Round',
              before: null,
              after: `Round ${round.value.number} of ${label(found.value.record)}`,
            },
            ...results.map((r) => ({
              label: `Condition ${r.trial}`,
              before: null,
              after: Object.entries(r.results)
                .map(([key, value]) => `${key} ${value}`)
                .join(', '),
            })),
          ],
          action: {
            kind: 'campaign.results',
            roundId: round.value.id,
            recordId: found.value.record.id,
            results,
          },
        },
      }
    }
  }
}
