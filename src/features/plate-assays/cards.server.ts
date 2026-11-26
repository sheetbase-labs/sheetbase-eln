import type { ProviderToolDef } from '#/lib/ai-providers/types'
import {
  findExperiment,
  invalid,
  likeValue,
  resolveInstrument,
  toolDef,
} from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { findProject } from '#/lib/assistant-labwork.server'
import type { ProposalChange } from '#/lib/assistant-proposals'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'
import { normaliseAssayConfig } from '#/lib/plate-assay'
import type { PlateAssayConfig } from '#/lib/plate-assay'
import {
  autoFillPlate,
  plateDesignDocToSpec,
  toPlateDesignDoc,
} from '#/lib/plate-designer'
import type { PlateDesignWire, PlateWellWire } from '#/lib/plate-designer'
import { FORMAT_DIMENSIONS } from '#/lib/plate-map'
import { fillPlate } from '#/lib/plate-map-fill'
import { plateRunReference, worklistReference } from '#/lib/plate-runs'

import type { FeatureProposalOutcome } from '../define.server'
import {
  PLATE_ASSAYS_PROPOSE_TOOL_NAMES,
  PLATE_DESIGN_CREATE_TOOL,
  PLATE_DESIGN_FILL_TOOL,
  PLATE_LAYOUT_SAVE_TOOL,
  PLATE_QC_TRACK_TOOL,
  PLATE_RUN_ARCHIVE_TOOL,
  PLATE_RUN_CREATE_TOOL,
  PLATE_RUN_UPDATE_TOOL,
  proposePlateDesignCreateSchema,
  proposePlateDesignFillSchema,
  proposePlateLayoutSaveSchema,
  proposePlateQcTrackSchema,
  proposePlateRunArchiveSchema,
  proposePlateRunCreateSchema,
  proposePlateRunUpdateSchema,
  proposeWorklistCancelSchema,
  proposeWorklistCompleteSchema,
  WORKLIST_CANCEL_TOOL,
  WORKLIST_COMPLETE_TOOL,
} from './cards'
import type { PlateAssaysAction, PlateAssaysProposeToolName } from './cards'

/**
 * The plate cards (see `cards.ts`). Each builder finds what the model named
 * by number or name under the signed-in person's own access and returns a card
 * that says what will change. Nothing is written here.
 */

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isPlateAssaysProposalTool(
  name: string,
): name is PlateAssaysProposeToolName {
  return PLATE_ASSAYS_PROPOSE_TOOL_NAMES.includes(name)
}

export function plateAssaysProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PLATE_RUN_CREATE_TOOL,
      `Propose setting up a plate run: its name, format, the samples laid out well by well (with replicates, blanks and an optional standard curve), and the experiment it belongs to. Readings are added later. ${NOTE}`,
      proposePlateRunCreateSchema,
    ),
    toolDef(
      PLATE_RUN_UPDATE_TOOL,
      `Propose renaming a plate run or changing how it is analysed (normalisation, blank subtraction, hit threshold). ${NOTE}`,
      proposePlateRunUpdateSchema,
    ),
    toolDef(
      PLATE_RUN_ARCHIVE_TOOL,
      `Propose archiving a plate run. ${NOTE}`,
      proposePlateRunArchiveSchema,
    ),
    toolDef(
      PLATE_DESIGN_CREATE_TOOL,
      `Propose a new, empty plate design (a reusable plate map). ${NOTE}`,
      proposePlateDesignCreateSchema,
    ),
    toolDef(
      PLATE_DESIGN_FILL_TOOL,
      `Propose laying samples out on a plate design with replicates, controls and a fill order. It replaces the wells the design has now. ${NOTE}`,
      proposePlateDesignFillSchema,
    ),
    toolDef(
      PLATE_LAYOUT_SAVE_TOOL,
      `Propose keeping a plate design's layout as a named, reusable layout template. ${NOTE}`,
      proposePlateLayoutSaveSchema,
    ),
    toolDef(
      PLATE_QC_TRACK_TOOL,
      `Propose keeping quality charts (Z-prime, signal to background and so on) for an assay design, so each plate run of it adds a point. ${NOTE}`,
      proposePlateQcTrackSchema,
    ),
    toolDef(
      WORKLIST_CANCEL_TOOL,
      `Propose cancelling a liquid handler worklist that has not been run. ${NOTE}`,
      proposeWorklistCancelSchema,
    ),
    toolDef(
      WORKLIST_COMPLETE_TOOL,
      `Propose marking a worklist as done, every transfer as planned. For a robot log with failures the person reconciles it on the Plates page. ${NOTE}`,
      proposeWorklistCompleteSchema,
    ),
  ]
}

const fail = (message: string): FeatureProposalOutcome => ({
  ok: false,
  message,
})

interface RunRow {
  id: string
  number: number
  name: string
  status: string
  config: unknown
  metadata_version: number
}

async function findRun(
  client: DataClient,
  text: string,
): Promise<Lookup<RunRow>> {
  const number = /^PLR-?(\d+)$/i.exec(text.trim())

  const rows = await client.list<RunRow>(
    'plate_runs',
    `?${
      number
        ? `number=eq.${Number(number[1])}`
        : `name=ilike.${likeValue(text)}`
    }&status=neq.archived&select=id,number,name,status,config,metadata_version&order=number.desc&limit=6`,
  )

  return pick(
    rows,
    text,
    'plate run',
    (row) => `${plateRunReference(row.number)} ${row.name}`,
    (row) =>
      (number !== null && row.number === Number(number[1])) ||
      row.name.toLowerCase() === text.trim().toLowerCase(),
  )
}

const runLabel = (row: RunRow): string =>
  `${plateRunReference(row.number)} · ${row.name}`

async function findDesign(
  client: DataClient,
  text: string,
): Promise<Lookup<PlateDesignWire>> {
  const rows = await client.list<PlateDesignWire>(
    'plate_designs',
    `?name=ilike.${likeValue(text)}&status=neq.archived&order=updated_at.desc&limit=6`,
  )

  return pick(
    rows,
    text,
    'plate design',
    (row) => row.name,
    (row) => row.name.toLowerCase() === text.trim().toLowerCase(),
  )
}

interface FoundWorklist {
  id: string
  number: number
  name: string
  status: string
}

async function findWorklist(
  client: DataClient,
  text: string,
): Promise<Lookup<FoundWorklist>> {
  const number = /^WL-?(\d+)$/i.exec(text.trim())

  const rows = await client.list<FoundWorklist>(
    'plate_worklists',
    `?${
      number
        ? `number=eq.${Number(number[1])}`
        : `name=ilike.${likeValue(text)}`
    }&status=eq.planned&select=id,number,name,status&order=number.desc&limit=6`,
  )

  return pick(
    rows,
    text,
    'planned worklist',
    (row) => `${worklistReference(row.number)} ${row.name}`,
    (row) => number !== null && row.number === Number(number[1]),
  )
}

/** Samples by ID or exact name, so a layout can link them. */
async function findSamples(
  client: DataClient,
  labels: readonly string[],
): Promise<Map<string, { id: string; identifier: string; title: string }>> {
  const found = new Map<
    string,
    { id: string; identifier: string; title: string }
  >()

  const unique = [...new Set(labels.map((label) => label.trim()))]

  for (let start = 0; start < unique.length; start += 100) {
    const batch = unique
      .slice(start, start + 100)
      .map((label) => `"${label.replaceAll(/[",()\\]/g, '')}"`)
      .join(',')

    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Batches are read in order so the first record to claim a title keeps it.
    const rows = await client.list<{
      id: string
      identifier: string
      title: string
    }>(
      'records',
      `?kind=eq.sample&deleted_at=is.null&or=(identifier.in.(${batch}),title.in.(${batch}))&select=id,identifier,title&limit=500`,
    )

    for (const row of rows) {
      for (const key of [row.identifier, row.title]) {
        if (!found.has(key)) found.set(key, row)
      }
    }
  }

  return found
}

export async function buildPlateAssaysProposal(
  name: PlateAssaysProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const { client } = context

  const card = (
    input: { title: string; summary: string },
    rest: {
      target: string
      deepLink: string | null
      changes: ProposalChange[]
      action: PlateAssaysAction
    },
  ): FeatureProposalOutcome => ({
    ok: true,
    proposal: {
      tool: name,
      title: input.title,
      summary: input.summary,
      ...rest,
    },
  })

  switch (name) {
    case PLATE_RUN_CREATE_TOOL: {
      const parsed = proposePlateRunCreateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const plateFormat = input.format ?? '96_well'
      let projectId: string | null = null
      let projectName: string | null = null

      if (input.project) {
        const project = await findProject(client, input.project)

        if (!project.ok) return fail(project.message)
        projectId = project.value.id
        projectName = project.value.title
      }

      let experimentId: string | null = null
      let experimentName: string | null = null

      if (input.experiment) {
        const experiment = await findExperiment(client, input.experiment)

        if ('message' in experiment) return fail(experiment.message)
        experimentId = experiment.id
        experimentName = `${experiment.identifier} · ${experiment.title}`
      }

      const filled = fillPlate({
        format: plateFormat,
        samples: input.samples ?? [],
        replicates: input.replicates ?? 1,
        direction: input.direction ?? 'across',
        dilution: input.dilution ?? 1,
        standards: input.standards
          ? { ...input.standards, replicates: input.standards.replicates ?? 2 }
          : null,
        blanks: input.blanks ?? 0,
      })

      if (filled.left.length > 0) {
        return fail(
          `${filled.left.length} of the samples do not fit on a ${plateFormat.replace('_', '-')} plate. Use a bigger plate or fewer samples.`,
        )
      }

      const found = await findSamples(client, input.samples ?? [])

      const wells = filled.wells.map((well) => {
        const sample = well.sampleLabel
          ? found.get(well.sampleLabel.trim())
          : undefined

        return sample
          ? { ...well, sampleId: sample.id, sampleLabel: sample.identifier }
          : well
      })

      const changes: ProposalChange[] = [
        { label: 'Format', before: null, after: plateFormat.replace('_', '-') },
        {
          label: 'Wells',
          before: null,
          after: `${wells.length} filled`,
        },
      ]

      if (projectName)
        changes.push({ label: 'Project', before: null, after: projectName })

      if (experimentName)
        changes.push({
          label: 'Experiment',
          before: null,
          after: experimentName,
        })

      return card(input, {
        target: `New plate run · ${input.name}`,
        deepLink: '/plates',
        changes,
        action: {
          kind: 'plate_run.create',
          name: input.name.trim(),
          format: plateFormat,
          projectId,
          experimentId,
          wells,
        },
      })
    }

    case PLATE_RUN_UPDATE_TOOL: {
      const parsed = proposePlateRunUpdateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      if (
        !input.name &&
        !input.normalisation &&
        input.subtractBlank === undefined &&
        input.hitThreshold === undefined
      ) {
        return fail('Say what to change on the plate run.')
      }

      const run = await findRun(client, input.run)

      if (!run.ok) return fail(run.message)
      const before = normaliseAssayConfig(run.value.config)
      const changes: ProposalChange[] = []
      let config: PlateAssayConfig | null = null

      if (input.name) {
        changes.push({
          label: 'Name',
          before: run.value.name,
          after: input.name.trim(),
        })
      }

      if (
        input.normalisation ||
        input.subtractBlank !== undefined ||
        input.hitThreshold !== undefined
      ) {
        config = { ...before }

        if (input.normalisation) {
          config.normalisation = input.normalisation
          changes.push({
            label: 'Normalised as',
            before: before.normalisation.replaceAll('_', ' '),
            after: input.normalisation.replaceAll('_', ' '),
          })
        }

        if (input.subtractBlank !== undefined) {
          config.subtractBlank = input.subtractBlank
          changes.push({
            label: 'Subtract blanks',
            before: before.subtractBlank ? 'Yes' : 'No',
            after: input.subtractBlank ? 'Yes' : 'No',
          })
        }

        if (input.hitThreshold !== undefined) {
          config.hit = {
            ...before.hit,
            kind: 'threshold',
            threshold: input.hitThreshold,
          }
          changes.push({
            label: 'Hit threshold',
            before:
              before.hit.kind === 'threshold'
                ? String(before.hit.threshold)
                : before.hit.kind,
            after: String(input.hitThreshold),
          })
        }
      }

      return card(input, {
        target: runLabel(run.value),
        deepLink: `/plates?run=${run.value.id}`,
        changes,
        action: {
          kind: 'plate_run.update',
          runId: run.value.id,
          metadataVersion: run.value.metadata_version,
          name: input.name?.trim() ?? null,
          config,
        },
      })
    }

    case PLATE_RUN_ARCHIVE_TOOL: {
      const parsed = proposePlateRunArchiveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const run = await findRun(client, input.run)

      if (!run.ok) return fail(run.message)

      return card(input, {
        target: runLabel(run.value),
        deepLink: '/plates',
        changes: [{ label: 'Plate run', before: 'Active', after: 'Archived' }],
        action: { kind: 'plate_run.archive', runId: run.value.id },
      })
    }

    case PLATE_DESIGN_CREATE_TOOL: {
      const parsed = proposePlateDesignCreateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const plateFormat = input.format ?? '96_well'
      let projectId: string | null = null

      if (input.project) {
        const project = await findProject(client, input.project)

        if (!project.ok) return fail(project.message)
        projectId = project.value.id
      }

      return card(input, {
        target: `New plate design · ${input.name}`,
        deepLink: '/plates',
        changes: [
          {
            label: 'Format',
            before: null,
            after: plateFormat.replace('_', '-'),
          },
        ],
        action: {
          kind: 'plate_design.create',
          workspaceId: context.workspaceId,
          name: input.name.trim(),
          format: plateFormat,
          projectId,
        },
      })
    }

    case PLATE_DESIGN_FILL_TOOL: {
      const parsed = proposePlateDesignFillSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const design = await findDesign(client, input.design)

      if (!design.ok) return fail(design.message)
      const found = await findSamples(client, input.samples)

      const missing = input.samples.filter((label) => !found.has(label.trim()))

      if (missing.length > 0) {
        return fail(
          `No sample matches ${missing.slice(0, 5).join(', ')}. A design lays out samples that exist; ask the person for their IDs.`,
        )
      }

      const wells = autoFillPlate(design.value.rows, design.value.cols, {
        samples: input.samples.map((label) => {
          const sample = found.get(label.trim())

          return {
            recordId: sample?.id ?? '',
            identifier: sample?.identifier ?? label,
            title: sample?.title ?? label,
          }
        }),
        replicates: input.replicates ?? 1,
        fillDirection: input.fillDirection ?? 'row',
        startWell: input.startWell ?? 'A1',
        controls: (input.controls ?? []).map((control) => ({
          role: control.role,
          wellCode: control.well.toUpperCase(),
        })),
        randomize: input.randomize ?? false,
        seed: 1,
      })

      const placed = wells.filter((well) => well.role === 'sample').length
      const wanted = input.samples.length * (input.replicates ?? 1)

      if (placed < wanted) {
        return fail(
          `Only ${placed} of ${wanted} sample wells fit on ${design.value.name}. Use fewer replicates or samples.`,
        )
      }

      return card(input, {
        target: design.value.name,
        deepLink: '/plates',
        changes: [
          {
            label: 'Samples',
            before: null,
            after: String(input.samples.length),
          },
          {
            label: 'Wells',
            before: null,
            after: `${wells.length} filled of ${design.value.rows * design.value.cols}`,
          },
        ],
        action: {
          kind: 'plate_design.fill',
          designId: design.value.id,
          metadataVersion: design.value.metadata_version,
          wells,
        },
      })
    }

    case PLATE_LAYOUT_SAVE_TOOL: {
      const parsed = proposePlateLayoutSaveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const design = await findDesign(client, input.design)

      if (!design.ok) return fail(design.message)

      const wells = await client.list<PlateWellWire>(
        'plate_wells',
        `?design_id=eq.${design.value.id}&order=row_index,col_index`,
      )

      if (wells.length === 0) {
        return fail(`${design.value.name} has no wells filled in yet.`)
      }

      const layout = plateDesignDocToSpec(toPlateDesignDoc(design.value, wells))

      return card(input, {
        target: `New layout template · ${input.name}`,
        deepLink: '/plates',
        changes: [
          { label: 'From design', before: null, after: design.value.name },
          { label: 'Wells', before: null, after: String(wells.length) },
        ],
        action: {
          kind: 'plate_layout.save',
          workspaceId: context.workspaceId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          format: design.value.format,
          rows:
            design.value.rows ?? FORMAT_DIMENSIONS[design.value.format].rows,
          cols:
            design.value.cols ?? FORMAT_DIMENSIONS[design.value.format].cols,
          layout,
        },
      })
    }

    case PLATE_QC_TRACK_TOOL: {
      const parsed = proposePlateQcTrackSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const design = await findDesign(client, input.design)

      if (!design.ok) return fail(design.message)
      let instrumentId: string | null = null
      let instrumentName: string | null = null

      if (input.instrument) {
        const instrument = await resolveInstrument(
          client,
          context.workspaceId,
          input.instrument,
        )

        if (!instrument.ok) return fail(instrument.message)
        instrumentId = instrument.instrument.id
        instrumentName = instrument.instrument.name
      }

      return card(input, {
        target: design.value.name,
        deepLink: '/quality',
        changes: [
          {
            label: 'Quality charts',
            before: null,
            after: instrumentName
              ? `Kept for runs read on ${instrumentName}`
              : 'Kept for every run of this design',
          },
        ],
        action: {
          kind: 'plate_design.track_qc',
          designId: design.value.id,
          instrumentId,
        },
      })
    }

    case WORKLIST_CANCEL_TOOL: {
      const parsed = proposeWorklistCancelSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const worklist = await findWorklist(client, input.worklist)

      if (!worklist.ok) return fail(worklist.message)

      return card(input, {
        target: `${worklistReference(worklist.value.number)} · ${worklist.value.name}`,
        deepLink: '/plates',
        changes: [{ label: 'Worklist', before: 'Planned', after: 'Cancelled' }],
        action: { kind: 'worklist.cancel', worklistId: worklist.value.id },
      })
    }

    case WORKLIST_COMPLETE_TOOL: {
      const parsed = proposeWorklistCompleteSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const worklist = await findWorklist(client, input.worklist)

      if (!worklist.ok) return fail(worklist.message)
      let experimentId: string | null = null
      let experimentName: string | null = null

      if (input.experiment) {
        const experiment = await findExperiment(client, input.experiment)

        if ('message' in experiment) return fail(experiment.message)
        experimentId = experiment.id
        experimentName = `${experiment.identifier} · ${experiment.title}`
      }

      if (input.recordWithdrawals && !experimentId) {
        return fail(
          'Taking the volumes out of the samples needs the experiment they were used for. Ask the person which one.',
        )
      }

      return card(input, {
        target: `${worklistReference(worklist.value.number)} · ${worklist.value.name}`,
        deepLink: '/plates',
        changes: [
          {
            label: 'Worklist',
            before: 'Planned',
            after: 'Done, every transfer as planned',
          },
          ...(experimentName
            ? [{ label: 'Used for', before: null, after: experimentName }]
            : []),
          ...(input.recordWithdrawals
            ? [
                {
                  label: 'Samples',
                  before: null,
                  after: 'Moved volumes taken out',
                },
              ]
            : []),
        ],
        action: {
          kind: 'worklist.complete',
          worklistId: worklist.value.id,
          experimentId,
          recordWithdrawals: input.recordWithdrawals ?? false,
        },
      })
    }
  }
}
