/**
 * The built-in lab unit table. A value typed with a unit ("2 g") is stored in
 * the column's own unit ("2000 mg") when both units measure the same thing.
 *
 * The database holds the same table (`api.lab_units`) and does the
 * conversion that is stored; this copy previews it and checks a value before
 * it is sent. `tests/db/lab-units.test.ts` keeps the two the same.
 *
 * A unit converts to a dimension's base as `(value + preOffset) * factor /
 * divisor`. Only temperatures have an offset. A "×10⁶" in front of a unit
 * scales it, so "×10⁶ cells/mL" needs no row of its own, and two units with
 * the same name after the scale ("×10¹⁰ vg/mL" and "vg/mL") convert even
 * when the table doesn't list them.
 */
export interface LabUnit {
  symbol: string
  aliases: readonly string[]
  dimension: string
  factor: number
  divisor: number
  preOffset: number
}

const unit = (
  dimension: string,
  symbol: string,
  factor: number,
  aliases: readonly string[] = [],
  extra: { divisor?: number; preOffset?: number } = {},
): LabUnit => ({
  symbol,
  aliases,
  dimension,
  factor,
  divisor: extra.divisor ?? 1,
  preOffset: extra.preOffset ?? 0,
})

export const LAB_UNITS: readonly LabUnit[] = [
  unit('mass', 'kg', 1000),
  unit('mass', 'g', 1),
  unit('mass', 'mg', 1e-3),
  unit('mass', 'µg', 1e-6, ['ug', 'mcg']),
  unit('mass', 'ng', 1e-9),
  unit('mass', 'pg', 1e-12),
  unit('volume', 'L', 1, ['l']),
  unit('volume', 'mL', 1e-3, ['ml']),
  unit('volume', 'µL', 1e-6, ['uL', 'ul', 'µl']),
  unit('volume', 'nL', 1e-9, ['nl']),
  unit('amount', 'mol', 1),
  unit('amount', 'mmol', 1e-3),
  unit('amount', 'µmol', 1e-6, ['umol']),
  unit('amount', 'nmol', 1e-9),
  unit('amount', 'pmol', 1e-12),
  unit('molar concentration', 'M', 1, ['mol/L']),
  unit('molar concentration', 'mM', 1e-3, ['mmol/L']),
  unit('molar concentration', 'µM', 1e-6, ['uM', 'µmol/L', 'umol/L']),
  unit('molar concentration', 'nM', 1e-9, ['nmol/L']),
  unit('molar concentration', 'pM', 1e-12, ['pmol/L']),
  unit('mass concentration', 'g/mL', 1000, ['g/ml']),
  unit('mass concentration', 'g/L', 1, ['g/l']),
  unit('mass concentration', 'mg/mL', 1, ['mg/ml']),
  unit('mass concentration', 'ng/µL', 1, ['ng/uL', 'ng/ul']),
  unit('mass concentration', 'mg/L', 1e-3, ['mg/l']),
  unit('mass concentration', 'µg/mL', 1e-3, ['ug/mL', 'ug/ml', 'µg/ml']),
  unit('mass concentration', 'µg/L', 1e-6, ['ug/L']),
  unit('mass concentration', 'ng/mL', 1e-6, ['ng/ml']),
  unit('mass concentration', 'pg/mL', 1e-9, ['pg/ml']),
  unit('time', 'ms', 1e-3),
  unit('time', 's', 1, ['sec']),
  unit('time', 'min', 60, ['mins']),
  unit('time', 'h', 3600, ['hr', 'hrs']),
  unit('time', 'day', 86400, ['days', 'd']),
  unit('time', 'week', 604800, ['weeks', 'wk']),
  unit('temperature', 'K', 1),
  unit('temperature', '°C', 1, ['C', 'degC', 'ºC'], { preOffset: 273.15 }),
  unit('temperature', '°F', 5, ['F', 'degF', 'ºF'], {
    divisor: 9,
    preOffset: 459.67,
  }),
  unit('length', 'm', 1),
  unit('length', 'cm', 1e-2),
  unit('length', 'mm', 1e-3),
  unit('length', 'µm', 1e-6, ['um', 'micron']),
  unit('length', 'nm', 1e-9),
  unit('pressure', 'Pa', 1),
  unit('pressure', 'kPa', 1e3),
  unit('pressure', 'MPa', 1e6),
  unit('pressure', 'bar', 1e5),
  unit('pressure', 'mbar', 100),
  unit('pressure', 'psi', 6894.757293168),
  unit('pressure', 'atm', 101325),
  unit('pressure', 'mmHg', 133.322387415),
  unit('pressure', 'Torr', 101325, ['torr'], { divisor: 760 }),
  unit('flow rate', 'L/min', 1),
  unit('flow rate', 'mL/min', 1e-3, ['ml/min']),
  unit('flow rate', 'µL/min', 1e-6, ['uL/min']),
  unit('flow rate', 'L/h', 1, [], { divisor: 60 }),
  unit('flow rate', 'mL/h', 1, ['ml/h'], { divisor: 60000 }),
  unit('cell concentration', 'cells/mL', 1, ['cells/ml']),
  unit('cell concentration', 'cells/µL', 1000, ['cells/uL', 'cells/ul']),
]

const SUPERSCRIPTS = new Map([
  ['⁰', '0'],
  ['¹', '1'],
  ['²', '2'],
  ['³', '3'],
  ['⁴', '4'],
  ['⁵', '5'],
  ['⁶', '6'],
  ['⁷', '7'],
  ['⁸', '8'],
  ['⁹', '9'],
  ['⁻', '-'],
])

/**
 * Same spelling rules as `internal.lab_unit_text`: the Greek mu is the micro
 * sign, and superscripts are powers ("×10⁶" is "×10^6").
 */
export function normaliseUnitText(text: string): string {
  return text
    .replace(/μ/g, 'µ')
    .replace(
      /[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g,
      (run) => `^${run.replace(/./gu, (c) => SUPERSCRIPTS.get(c) ?? c)}`,
    )
    .replace(/\s+/g, ' ')
    .trim()
}

const BY_SPELLING = new Map<string, LabUnit>()

for (const entry of LAB_UNITS) {
  for (const spelling of [entry.symbol, ...entry.aliases])
    BY_SPELLING.set(normaliseUnitText(spelling), entry)
}

const SCALE = /^(?:×|x|\*)?\s*10\^(-?\d{1,3})\s+(.+)$/

/** A unit split into its "×10ⁿ" scale and the unit after it. */
function splitScale(text: string) {
  const normal = normaliseUnitText(text)
  const match = SCALE.exec(normal)

  if (!match) return { exponent: 0, base: normal }

  return { exponent: Number(match[1]), base: match[2] }
}

interface ResolvedUnit {
  dimension: string
  factor: number
  divisor: number
  preOffset: number
  exponent: number
}

function resolveUnit(text: string): ResolvedUnit {
  const { exponent, base } = splitScale(text)
  const known = BY_SPELLING.get(base)

  if (!known)
    return {
      dimension: `unit:${base}`,
      factor: 1,
      divisor: 1,
      preOffset: 0,
      exponent,
    }

  return { ...known, exponent }
}

/**
 * Rounded to 12 significant figures of the largest number in the sum, as
 * `internal.lab_unit_round` rounds, so "-40 °C" is "-40 °F" and not
 * "-40.0000000000001 °F".
 */
function roundConverted(value: number, magnitude: number): number {
  const scale = Math.max(Math.abs(value), magnitude)

  if (scale === 0) return 0
  const decimals = 11 - Math.floor(Math.log10(scale))

  if (decimals < 0) {
    const step = 10 ** -decimals

    return Math.round(value / step) * step
  }

  return Number(value.toFixed(Math.min(decimals, 100)))
}

/** True when the two spellings name the same unit ("ul" and "µL"). */
export function sameUnit(a: string, b: string): boolean {
  const from = resolveUnit(a)
  const to = resolveUnit(b)

  return (
    from.dimension === to.dimension &&
    from.factor === to.factor &&
    from.divisor === to.divisor &&
    from.preOffset === to.preOffset &&
    from.exponent === to.exponent
  )
}

/**
 * The value in another unit of the same dimension, or null when the two
 * units measure different things or either is not known.
 */
export function convertQuantity(
  value: number,
  from: string,
  to: string,
): number | null {
  if (!Number.isFinite(value)) return null

  const a = resolveUnit(from)
  const b = resolveUnit(to)

  if (a.dimension !== b.dimension) return null

  // Scaled units have no offset, so the scale applies to the whole value.
  const base = ((value * 10 ** a.exponent + a.preOffset) * a.factor) / a.divisor

  return roundConverted(
    ((base * b.divisor) / b.factor - b.preOffset) / 10 ** b.exponent,
    Math.max(a.preOffset, b.preOffset),
  )
}

const NUMBER = String.raw`[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)?`
const QUANTITY = new RegExp(String.raw`^\s*(${NUMBER})\s*(.*?)\s*$`)

/** "2 g" → { value: 2, unit: "g" }; a bare number has no unit. */
export function parseQuantityText(
  text: string,
): { value: number; unit: string | null } | null {
  const match = QUANTITY.exec(text)

  if (!match || !/\d/.test(match[1])) return null
  const value = Number(match[1].replace(/,/g, ''))

  if (!Number.isFinite(value)) return null
  // The unit as it was typed; conversion reads its spelling.
  const unitText = match[2].replace(/\s+/g, ' ').trim()

  return { value, unit: unitText === '' ? null : unitText }
}

export type QuantityEntry =
  | { kind: 'number'; value: number }
  | {
      kind: 'converted'
      value: number
      entered: { value: number; unit: string }
    }
  | { kind: 'wrong-unit'; entered: { value: number; unit: string } }
  | { kind: 'not-a-number' }

/**
 * What typed text means in a column stored in `storageUnit`. A bare number
 * or the column's own unit is a plain number; another unit of the same kind
 * is converted; any other unit is refused.
 */
export function quantityEntry(
  text: string,
  storageUnit: string,
): QuantityEntry {
  const parsed = parseQuantityText(text)

  if (!parsed) return { kind: 'not-a-number' }

  if (parsed.unit === null || sameUnit(parsed.unit, storageUnit))
    return { kind: 'number', value: parsed.value }

  const entered = { value: parsed.value, unit: parsed.unit }
  const value = convertQuantity(parsed.value, parsed.unit, storageUnit)

  if (value === null) return { kind: 'wrong-unit', entered }

  return { kind: 'converted', value, entered }
}

/** Every listed unit that a value stored in `unit` can be typed in. */
export function unitsLike(unitText: string): string[] {
  const target = resolveUnit(unitText)

  if (target.dimension.startsWith('unit:')) return []

  return LAB_UNITS.flatMap((u) =>
    u.dimension === target.dimension ? [u.symbol] : [],
  )
}
