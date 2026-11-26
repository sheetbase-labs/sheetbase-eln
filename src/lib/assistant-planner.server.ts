import { z } from 'zod'

import {
  PLANNER_PROPOSE_TOOL_NAMES,
  PLAN_TOOL,
  proposePlanSchema,
  tidyPlanArgs,
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
import { parsePlanAnswer, plateCounts } from './planner/plan'
import type { PlannerContext } from './planner/plan'

/**
 * Cards for the experiment planner (see `assistant-planner.ts`). Each
 * builder finds what the person named under their own access, checks what it
 * can and returns a card saying exactly what will change. Nothing is written
 * here.
 */

export type PlannerOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

const PLANNER_PROPOSE_TOOLS: ReadonlySet<string> = new Set(
  PLANNER_PROPOSE_TOOL_NAMES,
)

export function isPlannerProposalTool(
  name: string,
): name is PlannerProposeToolName {
  return PLANNER_PROPOSE_TOOLS.has(name)
}

export function plannerProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PLAN_TOOL,
      `Propose a plan for an experiment from a goal: the protocol to start from, its parts, a plate layout, a worklist for a liquid handler, samples to set aside and a request for a schedule. Name protocols, instruments and samples as the person does and use only ones that exist. Plan only what the goal asks for and say in warnings what you assumed. Pressing the button creates all of it together; nothing is booked until the person accepts the schedule. ${NOTE}`,
      proposePlanSchema,
    ),
  ]
}

interface NotebookTemplate {
  versionId: string
  label: string
}

/** The latest published version of the notebook template the person named, or none when they named none. */
async function findNotebookTemplate(
  context: LabToolContext,
  text: string | undefined,
): Promise<
  | Lookup<NotebookTemplate | null>
  | { ok: true; value: null; unpublished: string }
> {
  if (!text) return { ok: true, value: null }
  const like = likeValue(text)

  const rows = await context.client.list<{
    id: string
    display_id: string | null
    name: string
  }>(
    'notebook_templates',
    `?lifecycle=eq.active&or=(display_id.ilike.${like},name.ilike.${like})&select=id,display_id,name&order=updated_at.desc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  const found = pick(
    rows,
    text,
    'notebook template',
    (row) => `${row.display_id ?? ''} ${row.name}`,
    (row) =>
      row.display_id?.toLowerCase() === lower ||
      row.name.toLowerCase() === lower,
  )

  if (!found.ok) return found

  const versions = await context.client.list<{ id: string }>(
    'notebook_template_versions',
    `?template_id=eq.${found.value.id}&lifecycle=eq.published&select=id&order=version.desc&limit=1`,
  )

  const latest = versions.at(0)

  if (!latest) {
    return {
      ok: true,
      value: null,
      unpublished: found.value.display_id ?? found.value.name,
    }
  }

  return {
    ok: true,
    value: {
      versionId: latest.id,
      label: `${found.value.display_id ?? ''} ${found.value.name}`.trim(),
    },
  }
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

export async function buildPlannerProposal(
  name: PlannerProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; the first statement parses them with proposePlanSchema.
  args: unknown,
  context: LabToolContext,
): Promise<PlannerOutcome> {
  const tidy = tidyPlanArgs(args)

  if (!tidy.ok) return fail(tidy.message)
  const parsed = proposePlanSchema.safeParse(tidy.args)

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

  // A notebook template (TPL-0004) is not a protocol record: it fills the notebook.
  const notebook = await findNotebookTemplate(
    context,
    input.notebookTemplate ??
      (input.protocol && /^TPL-/i.test(input.protocol)
        ? input.protocol
        : undefined),
  )

  if (!notebook.ok) return fail(notebook.message)

  if (input.protocol && !(notebook.value && /^TPL-/i.test(input.protocol))) {
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

    const answer = {
      title: part.title,
      day: part.day ?? 0,
      handsOnMinutes: part.handsOnMinutes ?? 30,
      waitMinutes: part.waitMinutes ?? 0,
      instruments,
    }

    partsAnswer.push(part.gate ? { ...answer, gate: part.gate } : answer)
  }

  const samplesAnswer = []

  for (const wanted of input.samples ?? []) {
    const found = await findRecord(context, 'sample', wanted.sample, 'sample')

    if (!found.ok) return fail(found.message)

    const props = await context.client.list<{
      properties: Record<string, z.core.util.JSONType> | null
    }>('records', `?id=eq.${found.value.id}&select=properties&limit=1`)

    const quantity = Number(props[0]?.properties?.['quantity'])

    const unit = z
      .string()
      .min(1)
      .safeParse(props[0]?.properties?.['quantityUnit'])

    planContext.samples.push({
      ...found.value,
      quantity: Number.isFinite(quantity) ? quantity : null,
      unit: unit.success ? unit.data : null,
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

  if ('unpublished' in notebook) {
    plan.warnings.push(
      `${notebook.unpublished} is still a draft, so this experiment's notebook starts empty. Publish the template, then start the experiment from it.`,
    )
  }

  if (notebook.value) {
    plan.experiment.notebookTemplateVersionId = notebook.value.versionId
    plan.experiment.templateLabel = notebook.value.label
  }

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
      target: `${project.value.title} · New experiment`,
      deepLink: '/experiments',
      changes,
      action: {
        kind: 'plan.apply',
        projectId: project.value.id,
        plan,
      },
    },
  }
}
