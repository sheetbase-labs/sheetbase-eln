import {
  findExperiment,
  invalid,
  likeValue,
  toolDef,
} from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { ProviderToolDef } from './ai-providers/types'
import type { AssistantProposal } from './assistant-proposals'
import { recordDestination } from './navigation'
import { normaliseAssayConfig } from './plate-assay'
import type { AssayWell } from './plate-assay'
import { controlColumnsOfWells } from './plate-assay-setup'
import {
  PLATE_ADD_TOOL,
  PLATE_EXPERIMENT_PROPOSE_TOOL_NAMES,
  PLATE_REMEMBER_TOOL,
  proposePlateAddSchema,
  proposePlateRememberSchema,
} from './plate-experiment'
import { plateRunReference } from './plate-runs'

/** The server half of `plate-experiment.ts`: the card that puts a plate run in an experiment. */

type Outcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

interface RunRow {
  id: string
  number: number
  name: string
  status: string
  record_id: string | null
  design_id: string | null
  config: unknown
  wells: AssayWell[]
}

interface DesignRow {
  id: string
  name: string
}

export function plateExperimentProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PLATE_ADD_TOOL,
      'Propose putting a plate run in an experiment: the run is attached to it and a plate run block, with the plate map, Z′ and hits, is added to the end of its notebook. The person sees a card and presses a button; nothing changes until they do.',
      proposePlateAddSchema,
    ),
    toolDef(
      PLATE_REMEMBER_TOOL,
      'Propose remembering how a plate run was read (its control columns, normalisation, hit rule, curve and quality limits) on an assay design, so the next plate of the same assay is analysed the same way with nothing typed again. The person sees a card and presses a button; nothing changes until they do. A design name that matches none makes a new assay.',
      proposePlateRememberSchema,
    ),
  ]
}

export const isPlateExperimentProposalTool = (name: string): boolean =>
  PLATE_EXPERIMENT_PROPOSE_TOOL_NAMES.some((tool) => tool === name)

async function findRun(
  context: LabToolContext,
  text: string,
): Promise<{ run: RunRow } | { message: string }> {
  const number = /^PLR-?(\d+)$/i.exec(text.trim())

  const rows = await context.client.list<RunRow>(
    'plate_runs',
    `?${
      number
        ? `number=eq.${Number(number[1])}`
        : `name=ilike.${likeValue(text)}`
    }&status=neq.archived&select=id,number,name,status,record_id,design_id,config,wells&order=number.desc&limit=6`,
  )

  if (rows.length === 0) return { message: `No plate run matches "${text}".` }

  const exact = number
    ? rows.filter((r) => r.number === Number(number[1]))
    : rows.filter((r) => r.name.toLowerCase() === text.trim().toLowerCase())

  if (exact.length === 1) return { run: exact[0] }

  if (rows.length === 1) return { run: rows[0] }

  return {
    message: `More than one plate run matches "${text}": ${rows
      .map((r) => `${plateRunReference(r.number)} ${r.name}`)
      .join(', ')}. Ask the person which one, naming these.`,
  }
}

/** The settings a plate run was read with, in one plain line. */
function settingsLine(run: RunRow): string {
  const config = normaliseAssayConfig(run.config)
  const controls = controlColumnsOfWells(run.wells)

  const hit =
    config.hit.kind === 'threshold'
      ? `hit when ${config.hit.direction} ${config.hit.threshold}`
      : `hit rule ${config.hit.kind}`

  const columns = [
    controls.negative ? `negative control in ${controls.negative}` : '',
    controls.positive ? `positive control in ${controls.positive}` : '',
  ].filter(Boolean)

  return [
    config.normalisation.replaceAll('_', ' '),
    hit,
    `${config.curveModel} curve`,
    `Z′ passes at ${config.qc.zPrimeMin}`,
    ...columns,
  ].join(', ')
}

async function buildRememberProposal(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The model's tool call arrives as JSON; proposePlateRememberSchema decodes it below.
  args: unknown,
  context: LabToolContext,
): Promise<Outcome> {
  const parsed = proposePlateRememberSchema.safeParse(args)

  if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
  const input = parsed.data
  const found = await findRun(context, input.run)

  if ('message' in found) return { ok: false, message: found.message }
  const run = found.run

  const designs = await context.client.list<DesignRow>(
    'plate_designs',
    input.design
      ? `?name=ilike.${likeValue(input.design)}&status=neq.archived&select=id,name&order=name.asc&limit=6`
      : `?id=eq.${run.design_id ?? '00000000-0000-0000-0000-000000000000'}&select=id,name&limit=1`,
  )

  const exact = input.design
    ? designs.filter(
        (d) => d.name.toLowerCase() === (input.design ?? '').toLowerCase(),
      )
    : designs

  const chosen =
    exact.length === 1 ? exact[0] : designs.length === 1 ? designs[0] : null

  if (!input.design && !chosen)
    return {
      ok: false,
      message: `${plateRunReference(run.number)} follows no assay design. Ask the person what to call the assay, then propose again with that design name.`,
    }

  if (input.design && !chosen && designs.length > 1)
    return {
      ok: false,
      message: `More than one assay design matches "${input.design}": ${designs
        .map((d) => d.name)
        .join(', ')}. Ask the person which one, naming these.`,
    }

  const designName = chosen?.name ?? (input.design ?? '').trim()

  return {
    ok: true,
    proposal: {
      tool: PLATE_REMEMBER_TOOL,
      title: input.title,
      summary: input.summary,
      target: `${designName} · Assay setup`,
      deepLink: `/plates?run=${run.id}`,
      changes: [
        {
          label: 'Plate run',
          before: null,
          after: `${plateRunReference(run.number)} ${run.name}`,
        },
        {
          label: 'Assay design',
          before: chosen ? 'Remembers its setup' : 'Does not exist yet',
          after: chosen ? designName : `New assay: ${designName}`,
        },
        {
          label: 'Remembers',
          before: null,
          after: settingsLine(run),
        },
      ],
      action: {
        kind: 'plate.remember_setup',
        runId: run.id,
        designId: chosen?.id ?? null,
        designName,
        workspaceId: context.workspaceId,
      },
    },
  }
}

export async function buildPlateExperimentProposal(
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The model's tool call arrives as JSON; proposePlateAddSchema decodes it below.
  args: unknown,
  context: LabToolContext,
): Promise<Outcome> {
  if (name === PLATE_REMEMBER_TOOL) return buildRememberProposal(args, context)

  if (name !== PLATE_ADD_TOOL) return { ok: false, message: 'Unknown tool.' }
  const parsed = proposePlateAddSchema.safeParse(args)

  if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
  const input = parsed.data
  const found = await findRun(context, input.run)

  if ('message' in found) return { ok: false, message: found.message }
  const experiment = await findExperiment(context.client, input.experiment)

  if ('message' in experiment) return { ok: false, message: experiment.message }
  const run = found.run

  if (run.record_id === experiment.id)
    return {
      ok: false,
      message: `${plateRunReference(run.number)} is already in ${experiment.identifier}.`,
    }

  return {
    ok: true,
    proposal: {
      tool: PLATE_ADD_TOOL,
      title: input.title,
      summary: input.summary,
      target: `${experiment.identifier} · Notebook`,
      deepLink: recordDestination('experiment', experiment.id),
      changes: [
        {
          label: 'Plate run',
          before: null,
          after: `${plateRunReference(run.number)} ${run.name}`,
        },
        {
          label: 'Experiment',
          before: run.record_id
            ? 'In another experiment'
            : 'Not in an experiment',
          after: `${experiment.identifier} ${experiment.title}`,
        },
        {
          label: 'Adds',
          before: null,
          after:
            'A plate run block at the end of the notebook, with the plate map, Z′ and hits',
        },
      ],
      action: {
        kind: 'plate.add_to_experiment',
        runId: run.id,
        recordId: experiment.id,
      },
    },
  }
}
