/**
 * A measured amount as a scientist writes it: plain digits for everyday sizes,
 * "7.3 × 10¹¹" for very large or very small ones, never "730000000000".
 */

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'

const superscript = (n: number) =>
  String(n)
    .split('')
    .map((ch) => (ch === '-' ? '⁻' : (SUPERSCRIPT_DIGITS[Number(ch)] ?? ch)))
    .join('')

/** Three significant figures; scientific notation outside 0.001 to 999,999. */
export function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return ''

  if (value === 0) return '0'
  const abs = Math.abs(value)

  if (abs >= 1e6 || abs < 1e-3) {
    const exponent = Math.floor(Math.log10(abs))
    const mantissa = Number((value / 10 ** exponent).toPrecision(3))

    // Rounding can carry a mantissa to 10: 9.999 × 10⁴ is 1 × 10⁵.
    if (Math.abs(mantissa) >= 10)
      return `${Number((mantissa / 10).toPrecision(3))} × 10${superscript(exponent + 1)}`

    return `${mantissa} × 10${superscript(exponent)}`
  }

  return String(Number(value.toPrecision(3)))
}
