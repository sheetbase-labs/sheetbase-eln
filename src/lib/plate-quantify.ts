/**
 * Reading a plate by a standard curve: what an ELISA, a protein or DNA assay
 * asks for. The plate has standards of known concentration; a curve is fitted
 * to their readings, and each sample's reading is read back off it as a
 * concentration, multiplied by how far the sample was diluted. The answer is a
 * number per sample ("7.3 × 10¹¹ cp/mL"), not a hit.
 *
 * Whether a plate is read this way is the assay's choice (`config.method`,
 * remembered on its design), not something guessed from the file or the name.
 *
 * Nothing here guesses: with too few standards, a curve that will not fit, or a
 * reading outside what the standards cover, the sample says so and carries no
 * concentration.
 */

import { curveInverse, curveValue, fitCurve } from './curve-fit'
import type { CurveModel, CurveParameters } from './curve-fit'
import { summaryStats } from './stats'

/** The wells of one plate this module needs: roles and concentrations. */
export interface QuantifyWell {
  wellCode: string
  role: string
  sampleId?: string | null
  sampleLabel?: string | null
  concentration?: number | null
  concentrationUnit?: string | null
  /** How far the sample in this well was diluted (1 = neat). */
  dilution?: number | null
}

export interface StandardPoint {
  /** The concentration of the standard. */
  x: number
  /** Its mean reading. */
  y: number
  /** Wells behind the mean. */
  n: number
}

export interface StandardCurve {
  model: CurveModel
  params: CurveParameters
  points: StandardPoint[]
  unit: string | null
  r2: number
  converged: boolean
  /** The lowest and highest standard: the range the curve can be trusted over. */
  lo: number
  hi: number
  /** The curve's reading at the lowest and highest standard. */
  yLo: number
  yHi: number
}

export type QuantifiedStatus =
  'ok' | 'below_range' | 'above_range' | 'no_signal' | 'no_curve'

export interface QuantifiedSample {
  key: string
  sampleId: string | null
  label: string
  wells: string[]
  /** Wells that gave a concentration inside the standards' range. */
  n: number
  /** Mean reading of the sample's wells. */
  response: number | null
  /** How far the sample was diluted. */
  dilution: number
  /** What the curve reads, before the dilution is put back. */
  concentration: number | null
  /** The answer: the concentration times the dilution. */
  result: number | null
  unit: string | null
  /** Spread of the per-well answers, in percent. */
  cv: number | null
  status: QuantifiedStatus
  /** Some wells fell outside the range while others did not. */
  partlyOutOfRange: boolean
}

export type QuantifyFailure =
  'no_standards' | 'too_few_standards' | 'fit_failed'

export interface QuantifyResult {
  curve: StandardCurve | null
  failure: QuantifyFailure | null
  samples: QuantifiedSample[]
}

const MIN_STANDARDS: Record<CurveModel, number> = { '4pl': 4, '5pl': 5 }

const finite = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value)

interface CurveFitResult {
  curve: StandardCurve | null
  failure: QuantifyFailure | null
}

export function fitStandardCurve(
  wells: readonly QuantifyWell[],
  response: (wellCode: string) => number | null,
  model: CurveModel,
): CurveFitResult {
  const xs: number[] = []
  const ys: number[] = []
  let unit: string | null = null

  for (const well of wells) {
    if (well.role !== 'standard') continue
    const y = response(well.wellCode)

    if (!(finite(well.concentration) && well.concentration > 0)) continue

    if (y === null) continue
    xs.push(well.concentration)
    ys.push(y)
    unit ??= well.concentrationUnit ?? null
  }

  if (xs.length === 0) return { curve: null, failure: 'no_standards' }

  if (new Set(xs).size < MIN_STANDARDS[model])
    return { curve: null, failure: 'too_few_standards' }

  const fit = fitCurve(xs, ys, model)

  if (!fit) return { curve: null, failure: 'fit_failed' }

  const byConc = new Map<number, number[]>()

  xs.forEach((x, i) => byConc.set(x, [...(byConc.get(x) ?? []), ys[i]]))

  const points = [...byConc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, values]) => ({
      x,
      y: summaryStats(values)?.mean ?? values[0],
      n: values.length,
    }))

  const lo = points[0].x
  const hi = points[points.length - 1].x

  return {
    curve: {
      model,
      params: fit.params,
      points,
      unit,
      r2: fit.r2,
      converged: fit.converged,
      lo,
      hi,
      yLo: curveValue(fit.params, lo, model),
      yHi: curveValue(fit.params, hi, model),
    },
    failure: null,
  }
}

type WellOutcome =
  | { status: 'ok'; concentration: number }
  | { status: 'below_range' | 'above_range' | 'no_signal' }

/** One reading, read off the curve. */
function readWell(curve: StandardCurve, y: number | null): WellOutcome {
  if (y === null) return { status: 'no_signal' }
  const rising = curve.yHi > curve.yLo
  const outsideHigh = rising ? y > curve.yHi : y < curve.yHi
  const outsideLow = rising ? y < curve.yLo : y > curve.yLo

  if (outsideHigh) return { status: 'above_range' }

  if (outsideLow) return { status: 'below_range' }
  const x = curveInverse(curve.params, y, curve.model)

  if (x === null || x < curve.lo || x > curve.hi)
    return {
      status: x !== null && x > curve.hi ? 'above_range' : 'below_range',
    }

  return { status: 'ok', concentration: x }
}

/** Quantify every sample of a plate against the plate's own standards. */
export function quantifyPlate(
  wells: readonly QuantifyWell[],
  response: (wellCode: string) => number | null,
  options: { model: CurveModel; dilutionFactor: number },
): QuantifyResult {
  const { curve, failure } = fitStandardCurve(wells, response, options.model)
  const groups = new Map<string, QuantifyWell[]>()

  for (const well of wells) {
    if (well.role !== 'sample') continue
    const label = well.sampleLabel ?? well.sampleId ?? well.wellCode
    const key = well.sampleId ?? label

    groups.set(key, [...(groups.get(key) ?? []), well])
  }

  const samples: QuantifiedSample[] = [...groups.entries()].map(
    ([key, group]) => {
      const first = group[0]
      const label = first.sampleLabel ?? first.sampleId ?? first.wellCode

      const dilutionOf = (well: QuantifyWell) =>
        finite(well.dilution) && well.dilution > 0
          ? well.dilution
          : options.dilutionFactor

      const responses = group
        .map((well) => response(well.wellCode))
        .filter((value): value is number => value !== null)

      const base = {
        key,
        sampleId: first.sampleId ?? null,
        label,
        wells: group.map((well) => well.wellCode),
        response: summaryStats(responses)?.mean ?? null,
        dilution: dilutionOf(first),
        unit: curve?.unit ?? null,
      }

      if (!curve)
        return {
          ...base,
          n: 0,
          concentration: null,
          result: null,
          cv: null,
          status: 'no_curve' as const,
          partlyOutOfRange: false,
        }

      const read = group.map((well) => ({
        outcome: readWell(curve, response(well.wellCode)),
        dilution: dilutionOf(well),
      }))

      const inRange = read.flatMap((r) =>
        r.outcome.status === 'ok'
          ? [{ x: r.outcome.concentration, dilution: r.dilution }]
          : [],
      )

      if (inRange.length === 0) {
        const outcomes = read.map((r) => r.outcome.status)

        const status: QuantifiedStatus = outcomes.includes('above_range')
          ? 'above_range'
          : outcomes.includes('below_range')
            ? 'below_range'
            : 'no_signal'

        return {
          ...base,
          n: 0,
          concentration: null,
          result: null,
          cv: null,
          status,
          partlyOutOfRange: false,
        }
      }

      const answers = inRange.map((r) => r.x * r.dilution)
      const stats = summaryStats(answers)
      const raw = summaryStats(inRange.map((r) => r.x))

      return {
        ...base,
        n: inRange.length,
        concentration: raw?.mean ?? null,
        result: stats?.mean ?? null,
        cv:
          stats && stats.sd !== null && stats.mean !== 0
            ? (stats.sd / Math.abs(stats.mean)) * 100
            : null,
        status: 'ok' as const,
        partlyOutOfRange: inRange.length < group.length,
      }
    },
  )

  return { curve, failure, samples }
}
