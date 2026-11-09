import type { DataClient } from './data-client'
import { acknowledgeQcPoint, setQcBaseline } from './run-qc'
import type { QcAction, QcActionResult } from './assistant-qc'

/** Runs a quality control card's action. Loaded only in the browser, when a button is pressed. */
export async function runQcAction(
  client: DataClient,
  action: QcAction,
): Promise<QcActionResult | undefined> {
  switch (action.kind) {
    case 'qc.set_baseline':
      await setQcBaseline(client, action.seriesId, action.limits)

      return { openHref: '/plates' }
    case 'qc.acknowledge':
      for (const pointId of action.pointIds) {
        await acknowledgeQcPoint(client, {
          pointId,
          note: action.note,
          exclude: action.exclude,
        })
      }

      return { openHref: '/plates' }
  }
}
