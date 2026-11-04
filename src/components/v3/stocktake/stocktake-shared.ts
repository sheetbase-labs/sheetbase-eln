import type { Tone } from '#/components/v3/ui/status'
import { t } from '#/copy'
import type { StocktakeItemState, StocktakeStatus } from '#/lib/stocktake'

export const ITEM_TONE: Record<StocktakeItemState, Tone> = {
  expected: 'none',
  confirmed: 'ok',
  misplaced: 'warn',
  unexpected: 'warn',
  missing: 'bad',
}

export function itemStateLabel(state: StocktakeItemState): string {
  return t(`library.stocktake.state.${state}`)
}

export const STATUS_TONE: Record<StocktakeStatus, Tone> = {
  open: 'progress',
  completed: 'ok',
  cancelled: 'none',
}

export function statusLabel(status: StocktakeStatus): string {
  return t(`library.stocktake.status.${status}`)
}

export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** A box's place, without the part the count already names. */
export function relativePath(scopePath: string, path: string): string {
  return path.startsWith(`${scopePath} / `)
    ? path.slice(scopePath.length + 3)
    : path
}
