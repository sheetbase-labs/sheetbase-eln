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
  PLATE_PUBLISH_TOOL,
  PLATE_REMEMBER_TOOL,
  proposePlateAddSchema,
  proposePlatePublishSchema,
  proposePlateRememberSchema,
} from './plate-experiment'
import { plateRunReference } from './plate-runs'
import { suggestPlateStep } from './plate-step'
import type { PlateStepRow } from './plate-step'

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
  results?: {
    quantify?: {
      samples?: Array<{ sampleId?: string | null; result?: number | null }>
    }
  } | null
}

interface DesignRow {
  id: string
  name: string
}

export function plateExperimentProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PLATE_ADD_TOOL,
      'Propose putting a plate run in an experiment: the run is attached to it and a plate run block, with the plate map and its result, is added to the protocol step it was run for (the first open step that names plates, or the step you name), else the end of the notebook. The person sees a card and presses a button; nothing changes until they do.',
      proposePlateAddSchema,
    ),
    toolDef(
      PLATE_PUBLISH_TOOL,
      'Propose giving a plate run’s results to its samples: for a run read by a standard curve, each sample that read inside the standards gets its concentration as a measurement, so the result shows on the sample page. The person sees a card and presses a button; nothing changes until they do.',
      proposePlatePublishSchema,
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
    }&status=neq.archived&select=id,number,name,status,record_id,design_id,config,wells,results&order=number.desc&limit=6`,
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

  if (name === PLATE_PUBLISH_TOOL) return buildPublishProposal(args, context)

  if (name !== PLATE_ADD_TOOL) return { ok: false, message: 'Unknown tool.' }
  const parsed = proposePlateAddSchema.safeParse(args)

  if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
  const input = parsed.data
  const found = await findRun(context, input.run)

  if ('message' in found) return { ok: false, message: found.message }
  const experiment = await findExperiment(context.client, input.experiment)

  if ('message' in experiment) return { ok: false, message: experiment.message }
  const run = found.run

  // Which step it goes in: the one the person names, else the first open step
  // that names plates, else the end of the notebook.
  const steps = await context.client
    .rpc<PlateStepRow[]>('record_steps', { p_record_id: experiment.id })
    .catch((): PlateStepRow[] => [])

  const words = (input.step ?? '').toLowerCase().split(/\s+/).filter(Boolean)

  let step: PlateStepRow | null = null

  if (words.length > 0) {
    const matches = steps.filter((s) =>
      words.every((w) => (s.step_text ?? '').toLowerCase().includes(w)),
    )

    if (matches.length !== 1)
      return {
        ok: false,
        message:
          matches.length === 0
            ? `${experiment.identifier} has no step matching "${input.step}". Steps: ${steps.map((s) => `${s.step_number ?? '·'}. ${s.step_text ?? ''}`).join('; ') || 'none'}. Ask the person which.`
            : `More than one step of ${experiment.identifier} matches "${input.step}". Ask the person which.`,
      }
    step = matches[0]
  } else step = suggestPlateStep(steps)

  if (run.record_id === experiment.id && !step)
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
          after: step
            ? `A plate run block in step ${step.step_number ?? ''} (${(step.step_text ?? '').slice(0, 80)}), and the step reads in progress`
            : 'A plate run block at the end of the notebook, with the plate map and its result',
        },
      ],
      action: {
        kind: 'plate.add_to_experiment',
        runId: run.id,
        recordId: experiment.id,
        stepBlockId: step?.block_id ?? null,
      },
    },
  }
}

async function buildPublishProposal(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The model's tool call arrives as JSON; proposePlatePublishSchema decodes it below.
  args: unknown,
  context: LabToolContext,
): Promise<Outcome> {
  const parsed = proposePlatePublishSchema.safeParse(args)

  if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
  const input = parsed.data
  const found = await findRun(context, input.run)

  if ('message' in found) return { ok: false, message: found.message }
  const run = found.run
  const reference = plateRunReference(run.number)
  const samples = run.results?.quantify?.samples

  if (!samples)
    return {
      ok: false,
      message: `${reference} has not been read by a standard curve, so it has no sample results to give. Tell the person: its assay needs to be set to quantify and the plate analysed.`,
    }

  const readable = samples.filter(
    (s) => s.sampleId && s.result !== null && Number.isFinite(s.result),
  ).length

  if (readable === 0)
    return {
      ok: false,
      message: `No sample on ${reference} read inside the standard curve and is linked to a sample record, so there is nothing to give. Tell the person.`,
    }

  return {
    ok: true,
    proposal: {
      tool: PLATE_PUBLISH_TOOL,
      title: input.title,
      summary: input.summary,
      target: `${reference} · Samples`,
      deepLink: `/plates?run=${run.id}`,
      changes: [
        {
          label: 'Plate run',
          before: null,
          after: `${reference} ${run.name}`,
        },
        {
          label: 'Measurement',
          before: null,
          after: `${readable} sample${readable === 1 ? '' : 's'} get ${input.name ? `“${input.name}”` : 'a measurement'} from the standard curve, replacing what this run gave before`,
        },
      ],
      action: {
        kind: 'plate.publish_measurements',
        runId: run.id,
        name: input.name ?? null,
      },
    },
  }
}
