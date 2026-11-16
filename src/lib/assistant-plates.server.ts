import {
  PLATES_PROPOSE_TOOL_NAMES,
  PLATE_ANALYSE_TOOL,
  WORKLIST_CREATE_TOOL,
  proposePlateAnalyseSchema,
  proposeWorklistCreateSchema,
} from './assistant-plates'
import type { PlatesProposeToolName } from './assistant-plates'
import { destinationsOf } from './assistant-plates-run'
import {
  invalid,
  likeValue,
  resolveInstrument,
  toolDef,
} from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { ProviderToolDef } from './ai-providers/types'
import { normaliseAssayConfig } from './plate-assay'
import type { PlateAnalysis, AssayWell } from './plate-assay'
import { plateRunReference } from './plate-runs'
import { buildHitWorklist, buildWorklist, hitsToPick } from './plate-worklist'
import type { WorklistFormat } from './plate-worklist'
import type { PlateFormat } from './plate-map'

/**
 * Cards for plates (see `assistant-plates.ts`). Each builder finds the run the
 * person named under their own access, checks what it can, and returns a card
 * saying exactly what will change. Nothing is written here.
 */

export type PlatesOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isPlatesProposalTool(
  name: string,
): name is PlatesProposeToolName {
  return PLATES_PROPOSE_TOOL_NAMES.some((tool) => tool === name)
}

export function platesProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PLATE_ANALYSE_TOOL,
      `Propose analysing a plate run again against its own controls, saving the quality, hits and potency. For a run whose settings or readings changed. ${NOTE}`,
      proposePlateAnalyseSchema,
    ),
    toolDef(
      WORKLIST_CREATE_TOOL,
      `Propose making a liquid handler worklist from a plate run: the transfers a robot makes (Opentrons, Tecan, Hamilton, Echo or plain CSV), saved on the Plates page where the file can be downloaded. ${NOTE}`,
      proposeWorklistCreateSchema,
    ),
  ]
}

interface RunRow {
  id: string
  number: number
  name: string
  format: PlateFormat
  status: string
  qc_status: string | null
  wells: AssayWell[]
  config: unknown
  results: PlateAnalysis | null
}

const fail = (message: string): PlatesOutcome => ({ ok: false, message })

async function findRun(
  context: LabToolContext,
  text: string,
): Promise<{ ok: true; run: RunRow } | { ok: false; message: string }> {
  const number = /^PLR-?(\d+)$/i.exec(text.trim())

  const rows = await context.client.list<RunRow>(
    'plate_runs',
    `?${
      number
        ? `number=eq.${Number(number[1])}`
        : `name=ilike.${likeValue(text)}`
    }&status=neq.archived&select=id,number,name,format,status,qc_status,wells,config,results&order=number.desc&limit=6`,
  )

  if (rows.length === 0)
    return { ok: false, message: `No plate run matches "${text}".` }

  const exact = number
    ? rows.filter((r) => r.number === Number(number[1]))
    : rows.filter((r) => r.name.toLowerCase() === text.trim().toLowerCase())

  if (exact.length === 1) return { ok: true, run: exact[0] }

  if (rows.length === 1) return { ok: true, run: rows[0] }

  return {
    ok: false,
    message: `More than one plate run matches "${text}": ${rows
      .map((r) => `${plateRunReference(r.number)} ${r.name}`)
      .join(', ')}. Ask the person which one, naming these.`,
  }
}

export async function buildPlatesProposal(
  name: PlatesProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the model's tool call arrives as JSON; each case below parses it with its own schema.
  args: unknown,
  context: LabToolContext,
): Promise<PlatesOutcome> {
  switch (name) {
    case PLATE_ANALYSE_TOOL: {
      const parsed = proposePlateAnalyseSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findRun(context, input.run)

      if (!found.ok) return fail(found.message)
      const run = found.run
      const readings = run.wells.length

      if (readings === 0)
        return fail(`${plateRunReference(run.number)} has no wells to analyse.`)

      const changes: ProposalChange[] = [
        {
          label: 'Plate run',
          before: null,
          after: `${plateRunReference(run.number)} ${run.name}`,
        },
        {
          label: 'Quality',
          before: run.qc_status
            ? run.qc_status.replaceAll('_', ' ')
            : 'not analysed',
          after: 'checked again',
        },
        {
          label: 'Settings',
          before: null,
          after: normaliseAssayConfig(run.config).normalisation.replaceAll(
            '_',
            ' ',
          ),
        },
      ]

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${plateRunReference(run.number)} · Plates`,
          deepLink: `/plates?run=${run.id}`,
          changes,
          action: { kind: 'plate.analyse', runId: run.id },
        },
      }
    }

    case WORKLIST_CREATE_TOOL: {
      const parsed = proposeWorklistCreateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findRun(context, input.run)

      if (!found.ok) return fail(found.message)
      const run = found.run
      let format = input.format ?? 'csv'
      let minVolumeUl: number | null = null
      let maxVolumeUl: number | null = null
      let robotName: string | null = null

      if (input.robot) {
        const robot = await resolveInstrument(
          context.client,
          context.workspaceId,
          input.robot,
        )

        if (!robot.ok) return fail(robot.message)

        const settings = await context.client.list<{
          worklist_format: WorklistFormat
          min_transfer_ul: number | null
          max_transfer_ul: number | null
        }>(
          'instrument_robot_settings',
          `?instrument_id=eq.${robot.instrument.id}&select=worklist_format,min_transfer_ul,max_transfer_ul&limit=1`,
        )

        if (!settings[0])
          return fail(
            `${robot.instrument.name} is not set up as a robot yet. It can be set up on its instrument page, under Robot.`,
          )
        robotName = robot.instrument.name
        format = settings[0].worklist_format
        minVolumeUl = settings[0].min_transfer_ul
        maxVolumeUl = settings[0].max_transfer_ul
      }

      const mode = input.mode ?? 'stamp'
      const hitList = run.results ? hitsToPick(run.results) : []

      // Picking the called hits is what most people want after an assay, so it
      // is the default when the plate has hits and no other kind was asked for.
      const fromHits =
        (input.hits ?? input.mode === undefined) && hitList.length > 0

      if (input.hits === true && hitList.length === 0)
        return fail(
          `${plateRunReference(run.number)} has no called hits. Analyse the plate first, or ask for every well.`,
        )

      const reference = plateRunReference(run.number)

      const sourcePlate =
        input.sourcePlate?.trim() || (fromHits ? reference : 'SRC1')

      const plan = fromHits
        ? buildHitWorklist(hitList, {
            sourcePlate,
            sourceFormat: run.format,
            destPlate: `${reference} hits`,
            destFormat: run.format,
            volumeUl: input.volumeUl ?? 10,
            minVolumeUl: minVolumeUl ?? undefined,
            maxVolumeUl: maxVolumeUl ?? undefined,
          })
        : buildWorklist(destinationsOf(run.wells), {
            mode,
            sourcePlate,
            sourceFormat: run.format,
            destFormat: run.format,
            destPlate: reference,
            defaultVolumeUl: input.volumeUl,
            minVolumeUl: minVolumeUl ?? undefined,
            maxVolumeUl: maxVolumeUl ?? undefined,
          })

      if (plan.transfers.length === 0)
        return fail(
          `No wells of ${plateRunReference(run.number)} have a volume to move. Ask the person how many microlitres to move into each well.`,
        )

      const changes: ProposalChange[] = [
        {
          label: 'Plate run',
          before: null,
          after: `${plateRunReference(run.number)} ${run.name}`,
        },
        {
          label: 'For',
          before: null,
          after: robotName
            ? `${robotName} (${format.replaceAll('_', ' ')})`
            : format.replaceAll('_', ' '),
        },
        {
          label: 'Transfers',
          before: null,
          after: fromHits
            ? `${plan.transfers.length} hits into a new plate, ${input.volumeUl ?? 10} µL each`
            : `${plan.transfers.length} from ${plan.sources.length} source wells`,
        },
      ]

      if (plan.issues.length > 0)
        changes.push({
          label: 'Check',
          before: null,
          after: `${plan.issues.length} issue(s), such as: ${plan.issues[0].message}`,
        })

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${plateRunReference(run.number)} · Plates`,
          deepLink: '/plates',
          changes,
          action: {
            kind: 'worklist.create',
            runId: run.id,
            format,
            mode,
            fromHits,
            sourcePlate,
            volumeUl: input.volumeUl ?? null,
            minVolumeUl,
            maxVolumeUl,
          },
        },
      }
    }
  }
}
