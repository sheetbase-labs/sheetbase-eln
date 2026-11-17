/**
 * Putting a plate run into an experiment: attach it, then show it in the
 * notebook as a plate run block. The plate run dialog, the notebook block, the
 * Data tab and the assistant's card all do this the same way.
 */
import type { DataClient } from '#/lib/data-client'
import { insertBlock } from '#/lib/notebook-mutations'
import { recordSteps, suggestPlateStep } from '#/lib/plate-step'
import type { PlateStepRow } from '#/lib/plate-step'
import { fetchPlateRun, linkPlateRun } from '#/lib/plate-runs'
import type { PlateRunRow } from '#/lib/plate-runs'

export interface PlateRunPlacement {
  run: PlateRunRow
  /** The block now showing the run, or null when none could be added. */
  blockId: string | null
  /** The notebook already had a block for this run. */
  alreadyThere: boolean
  /** The protocol step the run was put in, or null when it went at the end. */
  step: PlateStepRow | null
}

interface BlockRef {
  id: string
  payload: { runId?: unknown } | null
}

/** The block that already shows this run in this notebook, if any. */
export async function findPlateRunBlock(
  client: DataClient,
  recordId: string,
  runId: string,
): Promise<string | null> {
  const blocks = await client.list<BlockRef>(
    'blocks',
    `?record_id=eq.${encodeURIComponent(recordId)}&type=eq.plate_run&select=id,payload&limit=200`,
  )

  return blocks.find((block) => block.payload?.runId === runId)?.id ?? null
}

/**
 * Attach a run to an experiment and put its plate run block in the notebook,
 * unless the notebook already shows that run.
 *
 * The block goes in the protocol step the run was done for, straight after the
 * step's own data, and the step reads "in progress". Name the step with
 * `stepBlockId`; leave it out and the step is the one the experiment's steps
 * suggest (the first open step that names plates); pass
 * `null` to put the block at the end of the notebook. A run already in the
 * notebook (at the end, say) is moved into the step.
 */
export async function addPlateRunToExperiment(
  client: DataClient,
  input: {
    runId: string
    recordId: string
    addBlock?: boolean
    stepBlockId?: string | null
  },
): Promise<PlateRunPlacement> {
  if (input.addBlock === false) {
    const run = await linkPlateRun(client, input.runId, input.recordId)

    return { run, blockId: null, alreadyThere: false, step: null }
  }

  let step: PlateStepRow | null = null

  if (input.stepBlockId !== null) {
    // A notebook without steps (or a read that fails) just puts the block at the end.
    const steps = await recordSteps(client, input.recordId).catch(() => [])

    step = input.stepBlockId
      ? (steps.find((s) => s.block_id === input.stepBlockId) ?? null)
      : suggestPlateStep(steps)
  }

  if (step) {
    const placed = await client.rpc<{
      block_id: string
      already_there: boolean
    }>('add_step_plate_run', {
      p_block_id: step.block_id,
      p_plate_run_id: input.runId,
    })

    const run = await fetchPlateRun(client, input.runId)

    if (!run) throw new Error('plate run not found')

    return {
      run,
      blockId: placed.block_id,
      alreadyThere: placed.already_there,
      step,
    }
  }

  const run = await linkPlateRun(client, input.runId, input.recordId)
  const existing = await findPlateRunBlock(client, input.recordId, run.id)

  if (existing)
    return { run, blockId: existing, alreadyThere: true, step: null }

  const inserted = await insertBlock(client, {
    recordId: input.recordId,
    type: 'plate_run',
    payload: { runId: run.id, view: 'hits' },
  })

  return { run, blockId: inserted.block.id, alreadyThere: false, step: null }
}
