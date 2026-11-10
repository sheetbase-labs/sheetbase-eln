/**
 * Unit tables for the bench calculators. Every unit carries its size in the
 * base unit of its kind (grams, litres, moles per litre, moles).
 */
export type UnitKind = 'mass' | 'volume' | 'concentration' | 'amount'

export interface UnitDef {
  id: string
  label: string
  kind: UnitKind
  /** Size of one of this unit in the base unit of its kind. */
  factor: number
}

const mass = (id: string, label: string, factor: number): UnitDef => ({
  id,
  label,
  kind: 'mass',
  factor,
})

export const UNITS: readonly UnitDef[] = [
  mass('kg', 'kg', 1000),
  mass('g', 'g', 1),
  mass('mg', 'mg', 1e-3),
  mass('ug', 'µg', 1e-6),
  mass('ng', 'ng', 1e-9),
  { id: 'L', label: 'L', kind: 'volume', factor: 1 },
  { id: 'mL', label: 'mL', kind: 'volume', factor: 1e-3 },
  { id: 'uL', label: 'µL', kind: 'volume', factor: 1e-6 },
  { id: 'M', label: 'M', kind: 'concentration', factor: 1 },
  { id: 'mM', label: 'mM', kind: 'concentration', factor: 1e-3 },
  { id: 'uM', label: 'µM', kind: 'concentration', factor: 1e-6 },
  { id: 'nM', label: 'nM', kind: 'concentration', factor: 1e-9 },
  { id: 'pM', label: 'pM', kind: 'concentration', factor: 1e-12 },
  { id: 'mol', label: 'mol', kind: 'amount', factor: 1 },
  { id: 'mmol', label: 'mmol', kind: 'amount', factor: 1e-3 },
  { id: 'umol', label: 'µmol', kind: 'amount', factor: 1e-6 },
  { id: 'nmol', label: 'nmol', kind: 'amount', factor: 1e-9 },
  { id: 'pmol', label: 'pmol', kind: 'amount', factor: 1e-12 },
]

const BY_ID = new Map(UNITS.map((u) => [u.id, u]))

export function unitById(id: string): UnitDef {
  const unit = BY_ID.get(id)

  if (!unit) throw new Error(`Unknown unit ${id}`)

  return unit
}

export function unitsOfKind(kind: UnitKind): UnitDef[] {
  return UNITS.filter((u) => u.kind === kind)
}

/** Convert a value between two units of the same kind. */
export function convertSameKind(value: number, from: string, to: string) {
  const a = unitById(from)
  const b = unitById(to)

  if (a.kind !== b.kind) throw new Error('Units are of different kinds')

  return (value * a.factor) / b.factor
}

/** Format a number for a bench: 4 significant figures, no float noise. */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return ''

  if (value === 0) return '0'
  const abs = Math.abs(value)

  if (abs >= 1e6 || abs < 1e-3)
    return Number(value.toPrecision(4)).toExponential()

  return String(Number(value.toPrecision(4)))
}

/** Pick the unit of a kind that gives the most readable number (1 to 999). */
export function friendlyUnit(baseValue: number, kind: UnitKind) {
  const candidates = unitsOfKind(kind).sort((a, b) => b.factor - a.factor)

  if (baseValue === 0) return { value: 0, unit: candidates[0] }

  for (const unit of candidates) {
    const v = baseValue / unit.factor

    if (Math.abs(v) >= 1 - 1e-9) return { value: v, unit }
  }

  const last = candidates[candidates.length - 1]

  return { value: baseValue / last.factor, unit: last }
}
