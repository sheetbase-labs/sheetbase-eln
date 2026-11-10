/**
 * Notebook Sheet-block identity helpers (CORE-06.2).
 *
 * Sheet blocks name a Sheet Instance. Scientific-table `{tableId}` payloads
 * are not a product contract.
 */
import { z } from 'zod'

/** A block payload, read for the one key a sheet block names. */
export interface SheetPayload {
  instanceId?: unknown
}

const instanceIdValue = z.string()

export function sheetBlockInstanceId(payload: SheetPayload): string | null {
  return instanceIdValue.safeParse(payload.instanceId).data ?? null
}

export function isCanonicalSheetBlock(payload: SheetPayload): boolean {
  return sheetBlockInstanceId(payload) !== null
}
