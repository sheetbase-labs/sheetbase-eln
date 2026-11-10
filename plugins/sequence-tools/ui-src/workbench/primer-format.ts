import { t } from '#/copy'

/** The warning codes a primer analysis returns, in the catalogue's words. */
export function warningText(codes: readonly string[]): string {
  return codes.map((c) => t(`molbio.primers.warning.${c}`)).join(', ')
}

/** A positive number typed into a field, or the fallback when it is not one. */
export function numberOr(value: string, fallback: number): number {
  const n = Number(value)

  return Number.isFinite(n) && n > 0 ? n : fallback
}
