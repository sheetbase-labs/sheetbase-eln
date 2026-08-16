/**
 * Notebook Sheet-block identity helpers (CORE-06.2).
 *
 * Canonical blocks name a Sheet Instance. Legacy blocks name a scientific
 * table. The payload never owns Dataset or Instance-local values.
 */

export function sheetBlockInstanceId(
  payload: Record<string, unknown>,
): string | null {
  return typeof payload.instanceId === 'string' ? payload.instanceId : null
}

export function sheetBlockTableId(
  payload: Record<string, unknown>,
): string | null {
  return typeof payload.tableId === 'string' ? payload.tableId : null
}

export function isCanonicalSheetBlock(
  payload: Record<string, unknown>,
): boolean {
  return sheetBlockInstanceId(payload) !== null
}

export function isLegacySheetBlock(payload: Record<string, unknown>): boolean {
  return (
    sheetBlockTableId(payload) !== null &&
    sheetBlockInstanceId(payload) === null
  )
}
