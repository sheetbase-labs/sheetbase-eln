import type { DataClient } from '#/lib/data-client'
import { fetchReagent, recordReagentMovement } from '#/lib/reagent-data'
import { fetchSample, withdrawSample } from '#/lib/samples'

/**
 * Take what a notebook materials block says it uses out of stock.
 *
 * A material is a reagent lot: the use is a `consume` movement on the lot's
 * ledger, with the experiment named as the reason. A sample is a withdrawal
 * for the experiment, which also links the sample to it. The block's unit must
 * be the unit the stock is kept in; the app does no unit conversion, so a
 * mismatch is refused with both units named rather than guessed at.
 */
export interface WithdrawableItem {
  kind: 'sample' | 'material'
  materialRecordId: string
  identifier: string
  quantity: number
  unit: { symbol: string }
}

/** The marker the block keeps on an item once it has been withdrawn. */
export const WITHDRAWN_NOTE_PREFIX = 'Withdrawn from stock'

export function isWithdrawn(item: { note?: string }): boolean {
  return Boolean(item.note?.startsWith(WITHDRAWN_NOTE_PREFIX))
}

function sameUnit(a: string | null, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()
}

export async function withdrawItemFromStock(
  client: DataClient,
  item: WithdrawableItem,
  experiment: { id: string },
): Promise<{ note: string }> {
  if (!(item.quantity > 0)) {
    throw new Error(`Enter an amount above zero for ${item.identifier}.`)
  }
  const note = `${WITHDRAWN_NOTE_PREFIX} ${new Date().toISOString().slice(0, 10)}`
  if (item.kind === 'material') {
    const lot = await fetchReagent(client, item.materialRecordId)
    if (!lot) throw new Error(`${item.identifier} could not be read.`)
    if (lot.unit && !sameUnit(lot.unit, item.unit.symbol)) {
      throw new Error(
        `${item.identifier} is stocked in ${lot.unit}, but this block uses ${item.unit.symbol}. Change the unit to ${lot.unit}, then withdraw.`,
      )
    }
    if (lot.quantity != null && item.quantity > lot.quantity) {
      throw new Error(
        `Only ${[lot.quantity, lot.unit].filter((v) => v != null).join(' ')} of ${item.identifier} is in stock.`,
      )
    }
    const experiments = await client.list<{ identifier: string }>(
      'records',
      `?id=eq.${encodeURIComponent(experiment.id)}&select=identifier&limit=1`,
    )
    const label = experiments.at(0)?.identifier
    await recordReagentMovement(client, {
      recordId: lot.id,
      operation: 'consume',
      quantityDelta: item.quantity,
      reason: label ? `Used in ${label}` : 'Used in an experiment',
      expectedMetadataVersion: lot.metadataVersion,
    })
    return { note }
  }
  const sample = await fetchSample(client, item.materialRecordId)
  if (!sample) throw new Error(`${item.identifier} could not be read.`)
  await withdrawSample(client, {
    recordId: sample.id,
    quantity: item.quantity,
    unit: item.unit.symbol,
    purposeExperimentId: experiment.id,
    expectedMetadataVersion: sample.metadataVersion,
  })
  return { note }
}
