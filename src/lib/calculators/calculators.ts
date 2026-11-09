import { convertSameKind, friendlyUnit, unitById } from './units'
import type { UnitKind } from './units'

export interface Quantity {
  value: number
  unit: string
}

export type CalcResult =
  | { ok: true; value: number; unit: string; summary: string }
  | { ok: false; reason: 'missing' | 'invalid' }

const base = (q: Quantity) => q.value * unitById(q.unit).factor

const valid = (q: Quantity | undefined): q is Quantity =>
  !!q && Number.isFinite(q.value) && q.value > 0

function out(baseValue: number, kind: UnitKind, preferred?: string) {
  if (preferred) {
    return { value: baseValue / unitById(preferred).factor, unit: preferred }
  }

  const f = friendlyUnit(baseValue, kind)

  return { value: f.value, unit: f.unit.id }
}

export type MolarityTarget = 'mass' | 'volume' | 'concentration'

export interface MolarityInput {
  target: MolarityTarget
  /** Molecular weight in g/mol. */
  molecularWeight: number
  mass?: Quantity
  volume?: Quantity
  concentration?: Quantity
  /** Unit to give the answer in; chosen to read well when omitted. */
  resultUnit?: string
}

/** mass = concentration × volume × molecular weight, solved for any one. */
export function solveMolarity(input: MolarityInput): CalcResult {
  const { target, molecularWeight: mw } = input

  if (!Number.isFinite(mw) || mw <= 0) return { ok: false, reason: 'missing' }

  const need = {
    mass: [input.volume, input.concentration],
    volume: [input.mass, input.concentration],
    concentration: [input.mass, input.volume],
  }[target]

  if (need.some((q) => !q || !Number.isFinite(q.value)))
    return { ok: false, reason: 'missing' }

  if (!need.every(valid)) return { ok: false, reason: 'invalid' }
  const [a, b] = need as [Quantity, Quantity]
  let baseValue: number
  let kind: UnitKind

  if (target === 'mass') {
    baseValue = base(b) * base(a) * mw
    kind = 'mass'
  } else if (target === 'volume') {
    baseValue = base(a) / mw / base(b)
    kind = 'volume'
  } else {
    baseValue = base(a) / mw / base(b)
    kind = 'concentration'
  }

  const r = out(baseValue, kind, input.resultUnit)
  const unitLabel = unitById(r.unit).label

  return { ok: true, ...r, summary: `${target}:${unitLabel}` }
}

export type DilutionTarget = 'c1' | 'v1' | 'c2' | 'v2'

export interface DilutionInput {
  target: DilutionTarget
  c1?: Quantity
  v1?: Quantity
  c2?: Quantity
  v2?: Quantity
  resultUnit?: string
}

/** C1 × V1 = C2 × V2, solved for any one. */
export function solveDilution(input: DilutionInput): CalcResult {
  const { target } = input
  const known = (['c1', 'v1', 'c2', 'v2'] as const).filter((k) => k !== target)
  const qs = known.map((k) => input[k])

  if (qs.some((q) => !q || !Number.isFinite(q.value)))
    return { ok: false, reason: 'missing' }

  if (!qs.every(valid)) return { ok: false, reason: 'invalid' }
  const b = (k: DilutionTarget) => base(input[k as 'c1'] as Quantity)
  let baseValue: number

  switch (target) {
    case 'c1':
      baseValue = (b('c2') * b('v2')) / b('v1')
      break
    case 'v1':
      baseValue = (b('c2') * b('v2')) / b('c1')
      break
    case 'c2':
      baseValue = (b('c1') * b('v1')) / b('v2')
      break
    default:
      baseValue = (b('c1') * b('v1')) / b('c2')
  }

  const kind: UnitKind = target[0] === 'c' ? 'concentration' : 'volume'
  const r = out(baseValue, kind, input.resultUnit)

  return { ok: true, ...r, summary: target }
}

export interface DilutionRecipe {
  stock: Quantity
  diluent: Quantity
  /** False when the stock is weaker than the target. */
  feasible: boolean
}

/** Volume of stock and diluent for a target, or why it cannot be done. */
export function dilutionRecipe(input: {
  stock: Quantity
  target: Quantity
  finalVolume: Quantity
}): DilutionRecipe | null {
  if (![input.stock, input.target, input.finalVolume].every(valid)) return null
  const v1 = (base(input.target) * base(input.finalVolume)) / base(input.stock)
  const v2 = base(input.finalVolume)
  const s = out(v1, 'volume')
  const d = out(Math.max(v2 - v1, 0), 'volume')

  return {
    stock: { value: s.value, unit: s.unit },
    diluent: { value: d.value, unit: d.unit },
    feasible: v1 <= v2 * (1 + 1e-12),
  }
}

/** Convert within a kind. */
export function convertQuantity(input: {
  value: number
  from: string
  to: string
}): CalcResult {
  if (!Number.isFinite(input.value)) return { ok: false, reason: 'missing' }

  try {
    const value = convertSameKind(input.value, input.from, input.to)

    return { ok: true, value, unit: input.to, summary: 'convert' }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

/** Convert between mass and amount units, or within a kind, using the molecular weight (g/mol). */
export function convertWithWeight(input: {
  value: number
  from: string
  to: string
  molecularWeight: number
}): CalcResult {
  if (!Number.isFinite(input.value)) return { ok: false, reason: 'missing' }
  const from = unitById(input.from)
  const to = unitById(input.to)

  if (from.kind === to.kind) return convertQuantity(input)

  if (!(input.molecularWeight > 0)) return { ok: false, reason: 'missing' }
  const baseValue = input.value * from.factor

  const converted =
    from.kind === 'mass' && to.kind === 'amount'
      ? baseValue / input.molecularWeight
      : from.kind === 'amount' && to.kind === 'mass'
        ? baseValue * input.molecularWeight
        : null

  if (converted === null) return { ok: false, reason: 'invalid' }

  return {
    ok: true,
    value: converted / to.factor,
    unit: input.to,
    summary: 'convert',
  }
}

/** Mass ↔ amount, using the molecular weight (g/mol). */
export function massToMoles(mass: Quantity, mw: number): Quantity | null {
  if (!valid(mass) || !(mw > 0)) return null
  const r = out(base(mass) / mw, 'amount')

  return { value: r.value, unit: r.unit }
}

export function molesToMass(amount: Quantity, mw: number): Quantity | null {
  if (!valid(amount) || !(mw > 0)) return null
  const r = out(base(amount) * mw, 'mass')

  return { value: r.value, unit: r.unit }
}

/** Temperature conversion between °C, °F and K. */
export type TempUnit = 'C' | 'F' | 'K'

export function convertTemperature(
  value: number,
  from: TempUnit,
  to: TempUnit,
) {
  const c =
    from === 'C'
      ? value
      : from === 'F'
        ? ((value - 32) * 5) / 9
        : value - 273.15

  return to === 'C' ? c : to === 'F' ? (c * 9) / 5 + 32 : c + 273.15
}
