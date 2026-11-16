/**
 * Putting a plate run into an experiment: attach it, then show it in the
 * notebook as a plate run block. The plate run dialog, the notebook block, the
 * Data tab and the assistant's card all do this the same way.
 */
import type { DataClient } from '#/lib/data-client'
import { insertBlock } from '#/lib/notebook-mutations'
import { linkPlateRun } from '#/lib/plate-runs'
import type { PlateRunRow } from '#/lib/plate-runs'

export interface PlateRunPlacement {
  run: PlateRunRow
  /** The block now showing the run, or null when none could be added. */
  blockId: string | null
  /** The notebook already had a block for this run. */
  alreadyThere: boolean
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
 * Attach a run to an experiment and put a plate run block at the end of its
 * notebook, unless the notebook already shows that run.
 */
export async function addPlateRunToExperiment(
  client: DataClient,
  input: { runId: string; recordId: string; addBlock?: boolean },
): Promise<PlateRunPlacement> {
  const run = await linkPlateRun(client, input.runId, input.recordId)

  if (input.addBlock === false)
    return { run, blockId: null, alreadyThere: false }

  const existing = await findPlateRunBlock(client, input.recordId, run.id)

  if (existing) return { run, blockId: existing, alreadyThere: true }

  const inserted = await insertBlock(client, {
    recordId: input.recordId,
    type: 'plate_run',
    payload: { runId: run.id, view: 'hits' },
  })

  return { run, blockId: inserted.block.id, alreadyThere: false }
}
