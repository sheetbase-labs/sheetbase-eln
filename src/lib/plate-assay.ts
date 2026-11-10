/**
 * Plate assay analysis: normalise a plate's readout to its own controls,
 * judge the plate (Z′, SSMD, signal-to-background), call hits by a stated
 * rule, fit dose–response curves per sample, and combine potencies across
 * plates.
 *
 * Pure and deterministic, so a saved run can be re-analysed with the same
 * numbers. Nothing here guesses: a metric that cannot be computed (no
 * controls, no spread, too few doses) is reported as such, never as a pass.
 */

import { z } from 'zod'

import { fitCurve } from './curve-fit'
import type { CurveFit, CurveModel } from './curve-fit'
import {
  ASSIGNMENT_ROLES,
  FORMAT_DIMENSIONS,
  PLATE_FORMATS,
  parseWellCode,
  rowLabel,
  wellCode,
} from './plate-map'
import type { AssignmentRole, PlateFormat } from './plate-map'
import { summaryStats, tCritical95 } from './stats'

export const PLATE_ASSAY_METHOD_VERSION = 1 as const

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const NORMALISATIONS = [
  'percent_effect',
  'percent_of_negative',
  'z_score',
  'robust_z',
  'none',
] as const

export type Normalisation = (typeof NORMALISATIONS)[number]

export const HIT_RULE_KINDS = ['threshold', 'sd', 'mad'] as const

export type HitRuleKind = (typeof HIT_RULE_KINDS)[number]

export const HIT_DIRECTIONS = ['above', 'below', 'either'] as const

export type HitDirection = (typeof HIT_DIRECTIONS)[number]

export interface HitRule {
  kind: HitRuleKind
  /**
   * threshold: the normalised value to pass. sd: how many standard
   * deviations of the negative controls. mad: how many robust z units.
   */
  threshold: number
  direction: HitDirection
  /** How many replicate wells of a sample must meet the rule (default: all). */
  minReplicates: number | 'all'
}

export interface QcLimits {
  /** Z′ at or above this passes. */
  zPrimeMin: number
  /** Z′ below this fails; between the two is a warning. */
  zPrimeFail: number
  /** Optional minimum signal-to-background; null to skip. */
  signalToBackgroundMin: number | null
  /** Optional maximum CV% of either control; null to skip. */
  controlCvMax: number | null
}

export interface PlateAssayConfig {
  version: typeof PLATE_ASSAY_METHOD_VERSION
  normalisation: Normalisation
  /** Label only: what a high normalised value means. */
  effectDirection: 'inhibition' | 'activation'
  /** Subtract the mean of the blank wells from every well first. */
  subtractBlank: boolean
  hit: HitRule
  qc: QcLimits
  curveModel: CurveModel
}

export function defaultAssayConfig(): PlateAssayConfig {
  return {
    version: PLATE_ASSAY_METHOD_VERSION,
    normalisation: 'percent_effect',
    effectDirection: 'inhibition',
    subtractBlank: false,
    hit: {
      kind: 'threshold',
      threshold: 50,
      direction: 'above',
      minReplicates: 'all',
    },
    qc: {
      zPrimeMin: 0.5,
      zPrimeFail: 0,
      signalToBackgroundMin: null,
      controlCvMax: null,
    },
    curveModel: '4pl',
  }
}

const objectInput = z.custom<object>(
  (value) =>
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Stored assay settings historically accept native nonarray objects without copying metadata or eagerly reading getters.
    typeof value === 'object' && value !== null && !Array.isArray(value),
)

const configInput = z.custom<{
  hit?: unknown
  qc?: unknown
  normalisation?: unknown
  effectDirection?: unknown
  subtractBlank?: unknown
  curveModel?: unknown
}>((value) => objectInput.safeParse(value).success)

const hitInput = z.custom<{
  kind?: unknown
  threshold?: unknown
  direction?: unknown
  minReplicates?: unknown
}>((value) => objectInput.safeParse(value).success)

const qcInput = z.custom<{
  zPrimeMin?: unknown
  zPrimeFail?: unknown
  signalToBackgroundMin?: unknown
  controlCvMax?: unknown
}>((value) => objectInput.safeParse(value).success)

const finiteNumberInput = z.number()

const numberInput = z.union([
  finiteNumberInput,
  z.nan(),
  z.literal(Infinity),
  z.literal(-Infinity),
])

const minReplicatesInput = finiteNumberInput.refine(Number.isInteger).min(1)
const normalisationInput = z.enum(NORMALISATIONS)
const hitKindInput = z.enum(HIT_RULE_KINDS)
const directionInput = z.enum(HIT_DIRECTIONS)

function isInput<Schema extends z.ZodType, Value>(
  schema: Schema,
  value: Value,
): value is Value & z.infer<Schema> {
  return schema.safeParse(value).success
}

/**
 * Read a stored config back, filling anything missing from the defaults so an
 * old run keeps loading after a field is added.
 */
export function normaliseAssayConfig<Value>(raw: Value): PlateAssayConfig {
  const base = defaultAssayConfig()

  if (!isInput(configInput, raw)) return base
  const hitRaw = isInput(hitInput, raw.hit) ? raw.hit : null
  const qcRaw = isInput(qcInput, raw.qc) ? raw.qc : null

  const minRep = hitRaw?.minReplicates

  return {
    version: PLATE_ASSAY_METHOD_VERSION,
    normalisation: isInput(normalisationInput, raw.normalisation)
      ? raw.normalisation
      : base.normalisation,
    effectDirection:
      raw.effectDirection === 'activation' ? 'activation' : 'inhibition',
    subtractBlank: raw.subtractBlank === true,
    hit: {
      kind: isInput(hitKindInput, hitRaw?.kind) ? hitRaw.kind : base.hit.kind,
      threshold: finiteNumberInput
        .catch(base.hit.threshold)
        .parse(hitRaw?.threshold),
      direction: isInput(directionInput, hitRaw?.direction)
        ? hitRaw.direction
        : base.hit.direction,
      minReplicates: isInput(minReplicatesInput, minRep) ? minRep : 'all',
    },
    qc: {
      zPrimeMin: finiteNumberInput
        .catch(base.qc.zPrimeMin)
        .parse(qcRaw?.zPrimeMin),
      zPrimeFail: finiteNumberInput
        .catch(base.qc.zPrimeFail)
        .parse(qcRaw?.zPrimeFail),
      signalToBackgroundMin: finiteNumberInput
        .nullable()
        .catch(base.qc.signalToBackgroundMin)
        .parse(qcRaw?.signalToBackgroundMin),
      controlCvMax: finiteNumberInput
        .nullable()
        .catch(base.qc.controlCvMax)
        .parse(qcRaw?.controlCvMax),
    },
    curveModel: raw.curveModel === '5pl' ? '5pl' : '4pl',
  }
}

// ---------------------------------------------------------------------------
// Inputs and results
// ---------------------------------------------------------------------------

export interface AssayWell {
  wellCode: string
  role: AssignmentRole
  /** Record id of the sample, when it is linked. */
  sampleId?: string | null
  /** Display name of the sample (identifier or free text). */
  sampleLabel?: string | null
  concentration?: number | null
  concentrationUnit?: string | null
  /** Volume to move into this well, in µL (used by worklists). */
  volumeUl?: number | null
}

/** Raw readout by well code. Blank or non-numeric readings are null. */
export type PlateReadout = Record<string, number | null>

export interface WellResult {
  wellCode: string
  role: AssignmentRole
  raw: number | null
  /** After blank subtraction (equals raw when off). */
  corrected: number | null
  normalised: number | null
  hit: boolean
  /** The well sits on the outer ring of the plate. */
  edge: boolean
}

export interface ControlStats {
  n: number
  mean: number | null
  sd: number | null
  cv: number | null
}

export type QcStatus = 'pass' | 'warn' | 'fail' | 'not_checked'

export interface PlateQc {
  positive: ControlStats
  negative: ControlStats
  blank: ControlStats
  zPrime: number | null
  ssmd: number | null
  signalToBackground: number | null
  signalToNoise: number | null
  status: QcStatus
  /** One entry per metric that was judged. */
  checks: Array<{
    id: 'z_prime' | 'signal_to_background' | 'control_cv' | 'controls_present'
    status: QcStatus
    value: number | null
    limit: number | null
  }>
}

export interface EdgeEffect {
  edgeMean: number | null
  innerMean: number | null
  /** Edge minus inner, as a percentage of the inner mean. */
  differencePct: number | null
  flagged: boolean
}

export interface SampleGroupResult {
  key: string
  sampleId: string | null
  label: string
  concentration: number | null
  concentrationUnit: string | null
  wells: string[]
  n: number
  mean: number | null
  sd: number | null
  cv: number | null
  hit: boolean
}

export interface SampleCurve {
  key: string
  sampleId: string | null
  label: string
  concentrationUnit: string | null
  /** Distinct doses and the points that were fitted. */
  points: Array<{ x: number; y: number }>
  model: CurveModel
  ec50: number
  ec50Ci95: { lo: number; hi: number } | null
  /** EC50 in mol/L when the unit is a molar one. */
  ec50Molar: number | null
  hill: number
  /** 5PL asymmetry (1 for a 4PL). */
  asymmetry?: number
  top: number
  bottom: number
  r2: number
  converged: boolean
  falling: boolean
  /** Reasons to read the number with care. */
  flags: Array<
    'ec50_outside_range' | 'no_plateau' | 'not_converged' | 'wide_interval'
  >
}

export interface PlateAnalysis {
  methodVersion: typeof PLATE_ASSAY_METHOD_VERSION
  config: PlateAssayConfig
  wells: WellResult[]
  qc: PlateQc
  edge: EdgeEffect
  samples: SampleGroupResult[]
  curves: SampleCurve[]
  /** Samples that had doses but too few to fit, with the reason. */
  unfitted: Array<{
    key: string
    label: string
    reason: 'too_few_doses' | 'fit_failed'
  }>
  summary: {
    wells: number
    readWells: number
    sampleWells: number
    hitSamples: number
    hitWells: number
    testedSamples: number
  }
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

function controlStats(values: number[]): ControlStats {
  const s = summaryStats(values)

  if (!s) return { n: 0, mean: null, sd: null, cv: null }

  return {
    n: s.n,
    mean: s.mean,
    sd: s.sd,
    cv: s.sd !== null && s.mean !== 0 ? (s.sd / Math.abs(s.mean)) * 100 : null,
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)

  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Median absolute deviation, scaled to match a standard deviation. */
export function madScaled(values: number[]): number | null {
  const m = median(values)

  if (m === null) return null
  const dev = median(values.map((v) => Math.abs(v - m)))

  return dev === null ? null : dev * 1.4826
}

const MOLAR_FACTORS = z.record(z.string(), finiteNumberInput.optional()).parse({
  pm: 1e-12,
  nm: 1e-9,
  um: 1e-6,
  µm: 1e-6,
  μm: 1e-6,
  mm: 1e-3,
  m: 1,
})

/** Factor to mol/L for a molar unit, or null for anything else. */
export function molarFactor(unit: string | null | undefined): number | null {
  if (!unit) return null

  return MOLAR_FACTORS[unit.trim().toLowerCase()] ?? null
}

function isEdge(code: string, rows: number, cols: number): boolean {
  const p = parseWellCode(code)

  if (!p) return false

  return p.row === 0 || p.col === 0 || p.row === rows - 1 || p.col === cols - 1
}

/** Dimensions to use for edge detection: the smallest standard format that holds the wells. */
export function inferPlateFormat(codes: string[]): PlateFormat | null {
  let maxRow = -1
  let maxCol = -1

  for (const code of codes) {
    const p = parseWellCode(code)

    if (!p) continue
    maxRow = Math.max(maxRow, p.row)
    maxCol = Math.max(maxCol, p.col)
  }

  if (maxRow < 0) return null

  return (
    PLATE_FORMATS.find(
      (f) =>
        FORMAT_DIMENSIONS[f].rows > maxRow &&
        FORMAT_DIMENSIONS[f].cols > maxCol,
    ) ?? null
  )
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function judgeQc(
  config: PlateAssayConfig,
  positive: ControlStats,
  negative: ControlStats,
  blank: ControlStats,
): PlateQc {
  const checks: PlateQc['checks'] = []
  const mp = positive.mean
  const mn = negative.mean

  const haveControls =
    positive.n >= 2 && negative.n >= 2 && mp !== null && mn !== null

  checks.push({
    id: 'controls_present',
    status: haveControls ? 'pass' : 'not_checked',
    value: Math.min(positive.n, negative.n),
    limit: 2,
  })

  let zPrime: number | null = null
  let ssmd: number | null = null
  let sb: number | null = null
  let sn: number | null = null

  if (haveControls) {
    const sp = positive.sd ?? 0
    const sn_ = negative.sd ?? 0
    const separation = Math.abs(mp - mn)

    if (separation > 0) zPrime = 1 - (3 * (sp + sn_)) / separation
    const pooled = Math.sqrt(sp * sp + sn_ * sn_)

    if (pooled > 0) ssmd = (mp - mn) / pooled
    // Signal-to-background is the higher control over the lower one, after any
    // blank is removed, so it reads the same whichever way the assay runs.
    const b = config.subtractBlank && blank.mean !== null ? blank.mean : 0
    const high = Math.max(mp, mn) - b
    const low = Math.min(mp, mn) - b

    if (low > 0) sb = high / low

    if (sn_ > 0) sn = separation / sn_
  }

  const zStatus: QcStatus =
    zPrime === null
      ? 'not_checked'
      : zPrime >= config.qc.zPrimeMin
        ? 'pass'
        : zPrime >= config.qc.zPrimeFail
          ? 'warn'
          : 'fail'

  checks.push({
    id: 'z_prime',
    status: zStatus,
    value: zPrime,
    limit: config.qc.zPrimeMin,
  })

  if (config.qc.signalToBackgroundMin !== null) {
    checks.push({
      id: 'signal_to_background',
      status:
        sb === null
          ? 'not_checked'
          : Math.abs(sb) >= config.qc.signalToBackgroundMin
            ? 'pass'
            : 'fail',
      value: sb,
      limit: config.qc.signalToBackgroundMin,
    })
  }

  if (config.qc.controlCvMax !== null) {
    const worst = Math.max(positive.cv ?? 0, negative.cv ?? 0)
    checks.push({
      id: 'control_cv',
      status:
        positive.cv === null && negative.cv === null
          ? 'not_checked'
          : worst <= config.qc.controlCvMax
            ? 'pass'
            : 'warn',
      value: worst,
      limit: config.qc.controlCvMax,
    })
  }

  const order: QcStatus[] = ['fail', 'warn', 'not_checked', 'pass']

  const status =
    order.find((s) => checks.some((c) => c.status === s)) ?? 'not_checked'

  return {
    positive,
    negative,
    blank,
    zPrime,
    ssmd,
    signalToBackground: sb,
    signalToNoise: sn,
    status,
    checks,
  }
}

function meetsRule(
  value: number,
  rule: HitRule,
  centre: number,
  scale: number | null,
): boolean {
  let signed: number

  if (rule.kind === 'threshold') {
    signed = value

    if (rule.direction === 'above') return signed >= rule.threshold

    if (rule.direction === 'below') return signed <= rule.threshold

    return Math.abs(signed) >= Math.abs(rule.threshold)
  }

  if (scale === null || !(scale > 0)) return false
  signed = (value - centre) / scale

  if (rule.direction === 'above') return signed >= rule.threshold

  if (rule.direction === 'below') return signed <= -rule.threshold

  return Math.abs(signed) >= rule.threshold
}

/** Analyse one plate. */
export function analysePlate<Config>(
  wells: AssayWell[],
  readout: PlateReadout,
  inputConfig?: Config,
): PlateAnalysis {
  const config = normaliseAssayConfig(inputConfig)
  const format = inferPlateFormat(wells.map((w) => w.wellCode))
  const dims = format ? FORMAT_DIMENSIONS[format] : { rows: 0, cols: 0 }

  const rawOf = (code: string) => {
    const v = readout[code]

    return isInput(finiteNumberInput, v) ? v : null
  }

  const byRole = (role: AssignmentRole) => wells.filter((w) => w.role === role)

  // Blank correction.
  const blankValues = byRole('blank')
    .map((w) => rawOf(w.wellCode))
    .filter((v): v is number => v !== null)

  const blankMean = summaryStats(blankValues)?.mean ?? null
  const offset = config.subtractBlank && blankMean !== null ? blankMean : 0

  const corrected = (code: string) => {
    const v = rawOf(code)

    return v === null ? null : v - offset
  }

  const valuesFor = (role: AssignmentRole) =>
    byRole(role)
      .map((w) => corrected(w.wellCode))
      .filter((v): v is number => v !== null)

  const positive = controlStats(valuesFor('positive_control'))
  const negative = controlStats(valuesFor('negative_control'))

  const blank = controlStats(
    byRole('blank')
      .map((w) => rawOf(w.wellCode))
      .filter((v): v is number => v !== null),
  )

  const qc = judgeQc(config, positive, negative, blank)

  // Normalisation.
  const sampleCorrected = byRole('sample')
    .map((w) => corrected(w.wellCode))
    .filter((v): v is number => v !== null)

  const sampleStats = summaryStats(sampleCorrected)
  const sampleMedian = median(sampleCorrected)
  const sampleMad = madScaled(sampleCorrected)

  const normalise = (x: number | null): number | null => {
    if (x === null) return null

    switch (config.normalisation) {
      case 'none':
        return x
      case 'percent_effect': {
        if (positive.mean === null || negative.mean === null) return null
        const span = positive.mean - negative.mean

        return span === 0 ? null : (100 * (x - negative.mean)) / span
      }

      case 'percent_of_negative': {
        if (negative.mean === null || negative.mean === 0) return null

        return (100 * x) / negative.mean
      }

      case 'z_score':
        return sampleStats && sampleStats.sd !== null && sampleStats.sd > 0
          ? (x - sampleStats.mean) / sampleStats.sd
          : null
      case 'robust_z':
        return sampleMedian !== null && sampleMad !== null && sampleMad > 0
          ? (x - sampleMedian) / sampleMad
          : null
    }
  }

  const results: WellResult[] = wells.map((w) => {
    const raw = rawOf(w.wellCode)
    const corr = corrected(w.wellCode)

    return {
      wellCode: w.wellCode,
      role: w.role,
      raw,
      corrected: corr,
      normalised: normalise(corr),
      hit: false,
      edge: dims.rows > 0 && isEdge(w.wellCode, dims.rows, dims.cols),
    }
  })

  const resultByCode = new Map(results.map((r) => [r.wellCode, r]))

  // Reference for sd / mad hit rules, in normalised units.
  const normalisedNegatives = results.flatMap((r) =>
    r.role === 'negative_control' && r.normalised !== null
      ? [r.normalised]
      : [],
  )

  const normalisedSamples = results.flatMap((r) =>
    r.role === 'sample' && r.normalised !== null ? [r.normalised] : [],
  )

  const negStats = summaryStats(normalisedNegatives)
  let centre = 0
  let scale: number | null = null

  if (config.hit.kind === 'sd') {
    centre = negStats?.mean ?? 0
    scale = negStats?.sd ?? null
  } else if (config.hit.kind === 'mad') {
    centre = median(normalisedSamples) ?? 0
    scale = madScaled(normalisedSamples)
  }

  // Group sample wells by sample and dose.
  const groups = new Map<string, SampleGroupResult>()

  for (const w of wells) {
    if (w.role !== 'sample') continue
    const label = w.sampleLabel ?? w.sampleId ?? w.wellCode
    const id = w.sampleId ?? null

    const conc = isInput(finiteNumberInput, w.concentration)
      ? w.concentration
      : null

    const key = `${id ?? label}|${conc ?? ''}|${w.concentrationUnit ?? ''}`
    let g = groups.get(key)

    if (!g) {
      g = {
        key,
        sampleId: id,
        label,
        concentration: conc,
        concentrationUnit: w.concentrationUnit ?? null,
        wells: [],
        n: 0,
        mean: null,
        sd: null,
        cv: null,
        hit: false,
      }
      groups.set(key, g)
    }

    g.wells.push(w.wellCode)
  }

  for (const g of groups.values()) {
    const values: number[] = []
    const passing: string[] = []

    for (const code of g.wells) {
      const r = resultByCode.get(code)

      if (!r || r.normalised === null) continue
      values.push(r.normalised)

      if (meetsRule(r.normalised, config.hit, centre, scale)) passing.push(code)
    }

    const s = summaryStats(values)
    g.n = values.length
    g.mean = s?.mean ?? null
    g.sd = s?.sd ?? null
    g.cv =
      s && s.sd !== null && s.mean !== 0
        ? (s.sd / Math.abs(s.mean)) * 100
        : null

    const need =
      config.hit.minReplicates === 'all'
        ? values.length
        : Math.min(config.hit.minReplicates, values.length)

    g.hit = values.length > 0 && passing.length >= need

    if (g.hit) for (const code of passing) resultByCode.get(code)!.hit = true
  }

  const samples = [...groups.values()]

  // Edge effect on sample wells (normalised).
  const edgeVals = results.flatMap((r) =>
    r.role === 'sample' && r.edge && r.normalised !== null
      ? [r.normalised]
      : [],
  )

  const innerVals = results.flatMap((r) =>
    r.role === 'sample' && !r.edge && r.normalised !== null
      ? [r.normalised]
      : [],
  )

  const edgeMean = summaryStats(edgeVals)?.mean ?? null
  const innerMean = summaryStats(innerVals)?.mean ?? null
  const innerSd = summaryStats(innerVals)?.sd ?? null

  const edge: EdgeEffect = {
    edgeMean,
    innerMean,
    differencePct:
      edgeMean !== null && innerMean !== null && innerMean !== 0
        ? (100 * (edgeMean - innerMean)) / Math.abs(innerMean)
        : null,
    flagged:
      edgeMean !== null &&
      innerMean !== null &&
      innerSd !== null &&
      innerSd > 0 &&
      edgeVals.length >= 4 &&
      Math.abs(edgeMean - innerMean) > 2 * innerSd,
  }

  const { curves, unfitted } = fitSampleCurves(wells, results, config)

  const sampleWells = results.filter((r) => r.role === 'sample')
  const testedKeys = new Set(samples.map((s) => s.sampleId ?? s.label))

  const hitKeys = new Set(
    samples.flatMap((s) => (s.hit ? [s.sampleId ?? s.label] : [])),
  )

  return {
    methodVersion: PLATE_ASSAY_METHOD_VERSION,
    config,
    wells: results,
    qc,
    edge,
    samples,
    curves,
    unfitted,
    summary: {
      wells: wells.length,
      readWells: results.filter((r) => r.raw !== null).length,
      sampleWells: sampleWells.length,
      hitSamples: hitKeys.size,
      hitWells: sampleWells.filter((r) => r.hit).length,
      testedSamples: testedKeys.size,
    },
  }
}

// ---------------------------------------------------------------------------
// Dose–response per sample
// ---------------------------------------------------------------------------

const MIN_DOSES: Record<CurveModel, number> = { '4pl': 4, '5pl': 5 }

function fitSampleCurves(
  wells: AssayWell[],
  results: WellResult[],
  config: PlateAssayConfig,
) {
  const byCode = new Map(results.map((r) => [r.wellCode, r]))

  const bySample = new Map<
    string,
    {
      sampleId: string | null
      label: string
      unit: string | null
      points: Array<{ x: number; y: number }>
    }
  >()

  for (const w of wells) {
    if (w.role !== 'sample') continue

    if (!(isInput(numberInput, w.concentration) && w.concentration > 0))
      continue
    const r = byCode.get(w.wellCode)

    if (!r || r.normalised === null) continue
    const label = w.sampleLabel ?? w.sampleId ?? w.wellCode
    const key = `${w.sampleId ?? label}|${w.concentrationUnit ?? ''}`
    let entry = bySample.get(key)

    if (!entry) {
      entry = {
        sampleId: w.sampleId ?? null,
        label,
        unit: w.concentrationUnit ?? null,
        points: [],
      }
      bySample.set(key, entry)
    }

    entry.points.push({ x: w.concentration, y: r.normalised })
  }

  const curves: SampleCurve[] = []
  const unfitted: PlateAnalysis['unfitted'] = []

  for (const [key, entry] of bySample) {
    const doses = new Set(entry.points.map((p) => p.x))

    if (doses.size < MIN_DOSES[config.curveModel]) {
      unfitted.push({ key, label: entry.label, reason: 'too_few_doses' })
      continue
    }

    const fit = fitCurve(
      entry.points.map((p) => p.x),
      entry.points.map((p) => p.y),
      config.curveModel,
    )

    if (!fit) {
      unfitted.push({ key, label: entry.label, reason: 'fit_failed' })
      continue
    }

    curves.push(curveFromFit(key, entry, fit, config.curveModel))
  }

  return { curves, unfitted }
}

function curveFromFit(
  key: string,
  entry: {
    sampleId: string | null
    label: string
    unit: string | null
    points: Array<{ x: number; y: number }>
  },
  fit: CurveFit,
  model: CurveModel,
): SampleCurve {
  const xs = entry.points.map((p) => p.x)
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  const flags: SampleCurve['flags'] = []

  if (fit.ec50 < lo || fit.ec50 > hi) flags.push('ec50_outside_range')
  const ys = entry.points.map((p) => p.y)
  const span = Math.abs(fit.params.A - fit.params.D)
  const yRange = Math.max(...ys) - Math.min(...ys)

  if (yRange > 0 && span > 1.5 * yRange) flags.push('no_plateau')

  if (!fit.converged) flags.push('not_converged')

  if (fit.ec50Ci95 && fit.ec50Ci95.hi / fit.ec50Ci95.lo > 100)
    flags.push('wide_interval')
  const factor = molarFactor(entry.unit)

  return {
    key,
    sampleId: entry.sampleId,
    label: entry.label,
    concentrationUnit: entry.unit,
    points: entry.points,
    model,
    ec50: fit.ec50,
    ec50Ci95: fit.ec50Ci95,
    ec50Molar: factor === null ? null : fit.ec50 * factor,
    hill: fit.params.B,
    asymmetry: fit.params.G,
    top: fit.params.A > fit.params.D ? fit.params.A : fit.params.D,
    bottom: fit.params.A > fit.params.D ? fit.params.D : fit.params.A,
    r2: fit.r2,
    converged: fit.converged,
    falling: fit.falling,
    flags,
  }
}

// ---------------------------------------------------------------------------
// Potency across plates
// ---------------------------------------------------------------------------

export interface PotencyInput {
  runId: string
  runName: string
  /** The plate's QC verdict; failed plates are left out by default. */
  qcStatus: QcStatus
  curves: SampleCurve[]
}

export interface PotencyPlateValue {
  runId: string
  runName: string
  ec50: number
  ec50Molar: number | null
  r2: number
  flags: SampleCurve['flags']
}

export interface PotencySummary {
  key: string
  sampleId: string | null
  label: string
  unit: string | null
  /** Plates that contributed. */
  n: number
  /** Geometric mean EC50 in `unit` (or mol/L when `molar`). */
  geoMean: number
  geoMeanCi95: { lo: number; hi: number } | null
  /** Geometric standard deviation as a fold (≥ 1); null with one plate. */
  geoSd: number | null
  /** Highest EC50 over lowest across plates. */
  foldRange: number | null
  /** −log10 of the geometric mean in mol/L, for molar units. */
  pEc50: number | null
  molar: boolean
  values: PotencyPlateValue[]
}

/**
 * Combine the per-plate curves of each sample into one potency. Plates that
 * failed QC are excluded unless `includeFailed`; samples are matched by
 * record id when linked, otherwise by label. Combining happens in mol/L when
 * the unit is molar so plates run in nM and µM agree.
 */
export function summarisePotency(
  inputs: PotencyInput[],
  options: { includeFailed?: boolean; excludeUnreliable?: boolean } = {},
): PotencySummary[] {
  const groups = new Map<
    string,
    {
      sampleId: string | null
      label: string
      unit: string | null
      molar: boolean
      values: PotencyPlateValue[]
    }
  >()

  for (const input of inputs) {
    if (input.qcStatus === 'fail' && !options.includeFailed) continue

    for (const c of input.curves) {
      if (options.excludeUnreliable && c.flags.length > 0) continue
      const molar = c.ec50Molar !== null
      const key = `${c.sampleId ?? c.label}|${molar ? 'M' : (c.concentrationUnit ?? '')}`
      let g = groups.get(key)

      if (!g) {
        g = {
          sampleId: c.sampleId,
          label: c.label,
          unit: molar ? 'M' : c.concentrationUnit,
          molar,
          values: [],
        }
        groups.set(key, g)
      }

      g.values.push({
        runId: input.runId,
        runName: input.runName,
        ec50: c.ec50,
        ec50Molar: c.ec50Molar,
        r2: c.r2,
        flags: c.flags,
      })
    }
  }

  const out: PotencySummary[] = []

  for (const [key, g] of groups) {
    // A historical 'M' key can mix molar and unconverted entries. Keep the
    // first entry's classification and Math.log10's original null-to-zero input.
    const logs = g.values.map((v) =>
      Math.log10(g.molar ? (v.ec50Molar === null ? 0 : v.ec50Molar) : v.ec50),
    )

    const n = logs.length
    const mean = logs.reduce((s, v) => s + v, 0) / n

    const sd =
      n > 1
        ? Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
        : null

    const half = sd !== null ? (tCritical95(n - 1) * sd) / Math.sqrt(n) : null
    const linear = logs.map((l) => 10 ** l)
    out.push({
      key,
      sampleId: g.sampleId,
      label: g.label,
      unit: g.unit,
      n,
      geoMean: 10 ** mean,
      geoMeanCi95:
        half === null
          ? null
          : { lo: 10 ** (mean - half), hi: 10 ** (mean + half) },
      geoSd: sd === null ? null : 10 ** sd,
      foldRange: n > 1 ? Math.max(...linear) / Math.min(...linear) : null,
      pEc50: g.molar ? -mean : null,
      molar: g.molar,
      values: g.values,
    })
  }

  return out.sort((a, b) => a.label.localeCompare(b.label))
}

/** EC50 of each sample relative to a reference sample (reference ÷ sample). */
export function relativePotency(
  summaries: PotencySummary[],
  referenceKey: string,
): Array<{ key: string; label: string; ratio: number }> | null {
  const ref = summaries.find((s) => s.key === referenceKey)

  if (!ref) return null

  return summaries.flatMap((s) =>
    s.key !== referenceKey && s.unit === ref.unit
      ? [
          {
            key: s.key,
            label: s.label,
            ratio: ref.geoMean / s.geoMean,
          },
        ]
      : [],
  )
}

// ---------------------------------------------------------------------------
// Reading a plate from text
// ---------------------------------------------------------------------------

export interface ParsedPlateTable {
  wells: AssayWell[]
  readout: PlateReadout
  format: PlateFormat | null
  warnings: string[]
}

const ROLE_ALIASES = z
  .record(z.string(), z.enum(ASSIGNMENT_ROLES).optional())
  .parse({
    sample: 'sample',
    s: 'sample',
    unknown: 'sample',
    compound: 'sample',
    positive: 'positive_control',
    positive_control: 'positive_control',
    'positive control': 'positive_control',
    pos: 'positive_control',
    pc: 'positive_control',
    max: 'positive_control',
    negative: 'negative_control',
    negative_control: 'negative_control',
    'negative control': 'negative_control',
    neg: 'negative_control',
    nc: 'negative_control',
    vehicle: 'negative_control',
    dmso: 'negative_control',
    min: 'negative_control',
    blank: 'blank',
    bl: 'blank',
    empty: 'empty',
  })

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i++
      } else quoted = !quoted
    } else if (ch === delimiter && !quoted) {
      cells.push(current.trim())
      current = ''
    } else current += ch
  }

  cells.push(current.trim())

  return cells
}

function toNumber(cell: string | undefined): number | null {
  if (cell === undefined) return null
  const c = cell.trim().replace(/,/g, cell.includes('.') ? '' : '.')

  if (c === '') return null
  const n = Number(c)

  return Number.isFinite(n) ? n : null
}

function normalWell(cell: string): string | null {
  const m = /^([A-Za-z]+)\s*0*([1-9][0-9]*)$/.exec(cell.trim())

  if (!m) return null

  return `${m[1].toUpperCase()}${m[2]}`
}

/**
 * Read a plate from pasted or uploaded text. Two shapes are understood:
 * a grid (a header of column numbers, rows labelled A, B, …) holding the
 * readout, or a list with a `well` column and any of `value`, `role`,
 * `sample`, `concentration` and `unit`. Sample wells default to the role
 * "sample" when the list has no role column.
 */
export function parsePlateTable(text: string): ParsedPlateTable {
  const warnings: string[] = []

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')

  const empty: ParsedPlateTable = {
    wells: [],
    readout: {},
    format: null,
    warnings,
  }

  if (lines.length === 0) return empty

  const delimiter = lines[0].includes('\t')
    ? '\t'
    : lines[0].includes(';') && !lines[0].includes(',')
      ? ';'
      : ','

  const rows = lines.map((l) => splitLine(l, delimiter))

  // Grid: first row is column numbers (first cell may be blank).
  const header = rows[0].slice(1).map((c) => Number(c))

  const looksLikeGrid =
    header.length >= 3 &&
    header.every((n, i) => Number.isInteger(n) && n === i + 1) &&
    rows.slice(1).every((r) => /^[A-Za-z]{1,2}$/.test(r[0] ?? ''))

  if (looksLikeGrid) {
    const readout: PlateReadout = {}
    const wells: AssayWell[] = []
    rows.slice(1).forEach((r) => {
      const label = r[0].toUpperCase()
      r.slice(1).forEach((cell, c) => {
        if (c >= header.length) return
        const code = `${label}${c + 1}`
        const v = toNumber(cell)
        readout[code] = v
        wells.push({ wellCode: code, role: 'sample' })
      })
    })

    return {
      wells,
      readout,
      format: inferPlateFormat(wells.map((w) => w.wellCode)),
      warnings,
    }
  }

  // List with a header.
  const head = rows[0].map((h) => h.toLowerCase().replace(/[\s_-]+/g, ''))

  const col = (...names: string[]) => {
    const aliases = new Set(names)

    return head.findIndex((h) => aliases.has(h))
  }

  const wellCol = col('well', 'wellcode', 'position', 'wellposition')

  if (wellCol < 0) {
    warnings.push('no_well_column')

    return empty
  }

  const valueCol = col(
    'value',
    'readout',
    'signal',
    'rfu',
    'od',
    'reading',
    'raw',
    'result',
  )

  const roleCol = col('role', 'type', 'welltype', 'control')

  const sampleCol = col(
    'sample',
    'compound',
    'samplename',
    'sampleid',
    'name',
    'id',
  )

  const concCol = col('concentration', 'conc', 'dose')
  const unitCol = col('unit', 'concentrationunit', 'concunit', 'units')
  const wells: AssayWell[] = []
  const readout: PlateReadout = {}
  const seen = new Set<string>()

  for (const r of rows.slice(1)) {
    const code = normalWell(r[wellCol] ?? '')

    if (!code || !parseWellCode(code)) {
      warnings.push(`bad_well:${r[wellCol] ?? ''}`)
      continue
    }

    if (seen.has(code)) {
      warnings.push(`duplicate_well:${code}`)
      continue
    }

    seen.add(code)
    let role: AssignmentRole = 'sample'

    if (roleCol >= 0) {
      const alias = ROLE_ALIASES[(r[roleCol] ?? '').trim().toLowerCase()]

      if (alias) role = alias
      else if ((r[roleCol] ?? '').trim() !== '')
        warnings.push(`bad_role:${r[roleCol]}`)
    }

    const label = sampleCol >= 0 ? (r[sampleCol] ?? '').trim() : ''
    wells.push({
      wellCode: code,
      role,
      sampleLabel: role === 'sample' && label !== '' ? label : null,
      concentration: concCol >= 0 ? toNumber(r[concCol]) : null,
      concentrationUnit:
        unitCol >= 0 && (r[unitCol] ?? '').trim() !== ''
          ? r[unitCol].trim()
          : null,
    })

    if (valueCol >= 0) readout[code] = toNumber(r[valueCol])
  }

  return {
    wells,
    readout,
    format: inferPlateFormat(wells.map((w) => w.wellCode)),
    warnings,
  }
}

/** All well codes of a format, row by row. */
export function allWellCodes(format: PlateFormat): string[] {
  const { rows, cols } = FORMAT_DIMENSIONS[format]
  const out: string[] = []

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out.push(wellCode(r, c))

  return out
}

/** Row labels of a format (A…P for 384, A…AF for 1536). */
export function rowLabels(format: PlateFormat): string[] {
  return Array.from({ length: FORMAT_DIMENSIONS[format].rows }, (_, i) =>
    rowLabel(i),
  )
}
