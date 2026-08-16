/**
 * Notebook Sheet-block identity helpers (CORE-06.2).
 *
 * Sheet blocks name a Sheet Instance. Scientific-table `{tableId}` payloads
 * are not a product contract.
 */

export function sheetBlockInstanceId(
  payload: Record<string, unknown>,
): string | null {
  return typeof payload.instanceId === 'string' ? payload.instanceId : null
}

export function isCanonicalSheetBlock(
  payload: Record<string, unknown>,
): boolean {
  return sheetBlockInstanceId(payload) !== null
}
