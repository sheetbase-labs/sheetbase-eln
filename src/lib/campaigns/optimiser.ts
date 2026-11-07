/**
 * The built-in optimiser: proposes the next batch of conditions for a campaign
 * with no outside software, so a campaign works on any install.
 *
 * With too few results to learn from it spreads the batch over the whole space
 * (each pick as far as it can be from everything tried and picked so far). Once
 * there are results it fits a Gaussian process to the campaign's score (see
 * `scoreObservations`), and picks the batch one trial at a time by expected
 * improvement, treating each pick as if its predicted result had come back so
 * the batch spreads out instead of repeating itself.
 *
 * Proposals are repeatable: the same campaign, results and seed give the same
 * batch. BayBE (in the Python runtime) is the other engine; this is the one
 * that is always there.
 */
import { mulberry32 } from '#/lib/plate-designer'

import { scoreObservations } from './campaign'
import type {
  Factor,
  FactorValue,
  Objective,
  Observation,
  TrialFactors,
} from './campaign'

export interface ProposeInput {
  factors: readonly Factor[]
  objectives: readonly Objective[]
  observations: readonly Observation[]
  batchSize: number
  seed: number
}

export interface ProposeOutput {
  trials: TrialFactors[]
  strategy: 'space-filling' | 'expected-improvement'
  note: string
  lengthScale?: number
  noise?: number
}

/** The most results the model learns from (the newest), to keep a round quick. */
export const MAX_LEARNED_OBSERVATIONS = 150
const MIN_OBSERVATIONS_TO_LEARN = 3

type Random = () => number

// Encoding -----------------------------------------------------------------

interface Space {
  dims: number
  encode: (factors: TrialFactors) => number[]
  sample: (random: Random) => TrialFactors
  /** A trial close to another one, for searching around what already works. */
  nudge: (factors: TrialFactors, random: Random) => TrialFactors
}

function sortedValues(factor: Factor): number[] {
  return [...((factor.values ?? []) as number[])].sort((a, b) => a - b)
}

function nearestIndex(values: number[], x: number): number {
  let best = 0
  for (let i = 1; i < values.length; i++)
    if (Math.abs(values[i] - x) < Math.abs(values[best] - x)) best = i
  return best
}

function roundTo(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number(x.toPrecision(4))))
}

function gaussian(random: Random): number {
  const u = Math.max(random(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
}

export function buildSpace(factors: readonly Factor[]): Space {
  const dims = factors.reduce(
    (sum, f) => sum + (f.kind === 'categorical' ? (f.values?.length ?? 0) : 1),
    0,
  )
  return {
    dims,
    encode(trial) {
      const out: number[] = []
      for (const f of factors) {
        const value = trial[f.key]
        if (f.kind === 'continuous') {
          const min = f.min ?? 0
          const max = f.max ?? 1
          out.push(((Number(value) - min) / (max - min)) as number)
        } else if (f.kind === 'discrete') {
          const values = sortedValues(f)
          out.push(nearestIndex(values, Number(value)) / (values.length - 1))
        } else {
          for (const choice of f.values ?? []) out.push(choice === value ? 1 : 0)
        }
      }
      return out
    },
    sample(random) {
      const trial: TrialFactors = {}
      for (const f of factors) {
        if (f.kind === 'continuous') {
          const min = f.min ?? 0
          const max = f.max ?? 1
          trial[f.key] = roundTo(min + random() * (max - min), min, max)
        } else {
          const values = (f.kind === 'discrete'
            ? sortedValues(f)
            : (f.values ?? [])) as FactorValue[]
          trial[f.key] = values[Math.floor(random() * values.length)]
        }
      }
      return trial
    },
    nudge(trial, random) {
      const out: TrialFactors = { ...trial }
      for (const f of factors) {
        if (f.kind === 'continuous') {
          const min = f.min ?? 0
          const max = f.max ?? 1
          out[f.key] = roundTo(
            Number(trial[f.key]) + gaussian(random) * 0.08 * (max - min),
            min,
            max,
          )
        } else if (f.kind === 'discrete') {
          const values = sortedValues(f)
          const at = nearestIndex(values, Number(trial[f.key]))
          const step = random() < 0.5 ? -1 : 1
          out[f.key] = values[Math.min(values.length - 1, Math.max(0, at + step))]
        } else if (random() < 0.15) {
          const values = f.values ?? []
          out[f.key] = values[Math.floor(random() * values.length)]
        }
      }
      return out
    },
  }
}

function squaredDistance(a: number[], b: number[], dims: number): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return sum / dims
}

function keyOf(trial: TrialFactors, factors: readonly Factor[]): string {
  return factors.map((f) => String(trial[f.key])).join('\u0000')
}

// Space-filling design -----------------------------------------------------

function spaceFilling(
  space: Space,
  factors: readonly Factor[],
  taken: number[][],
  batchSize: number,
  random: Random,
): TrialFactors[] {
  const chosen: TrialFactors[] = []
  const points = [...taken]
  const seen = new Set<string>()
  const pool = Math.max(300, 40 * space.dims)
  for (let pick = 0; pick < batchSize; pick++) {
    let best: TrialFactors | null = null
    let bestEncoded: number[] = []
    let bestDistance = -1
    for (let c = 0; c < pool; c++) {
      const trial = space.sample(random)
      if (seen.has(keyOf(trial, factors))) continue
      const encoded = space.encode(trial)
      let nearest = Infinity
      for (const p of points)
        nearest = Math.min(nearest, squaredDistance(encoded, p, space.dims))
      if (points.length === 0) nearest = random()
      if (nearest > bestDistance) {
        best = trial
        bestEncoded = encoded
        bestDistance = nearest
      }
    }
    if (!best) break
    seen.add(keyOf(best, factors))
    chosen.push(best)
    points.push(bestEncoded)
  }
  return chosen
}

// Gaussian process ---------------------------------------------------------

function kernel(a: number[], b: number[], dims: number, ell: number): number {
  return Math.exp(-squaredDistance(a, b, dims) / (2 * ell * ell))
}

/** Lower Cholesky factor of a positive definite matrix, or null if it is not. */
function cholesky(matrix: number[][]): number[][] | null {
  const n = matrix.length
  const L: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  )
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i][j]
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k]
      if (i === j) {
        if (sum <= 1e-12) return null
        L[i][i] = Math.sqrt(sum)
      } else L[i][j] = sum / L[j][j]
    }
  }
  return L
}

function forwardSolve(L: number[][], b: number[]): number[] {
  const out = new Array<number>(b.length)
  for (let i = 0; i < b.length; i++) {
    let sum = b[i]
    for (let k = 0; k < i; k++) sum -= L[i][k] * out[k]
    out[i] = sum / L[i][i]
  }
  return out
}

function logMarginal(L: number[][], z: number[]): number {
  let quad = 0
  let logDet = 0
  for (let i = 0; i < z.length; i++) {
    quad += z[i] * z[i]
    logDet += Math.log(L[i][i])
  }
  return -0.5 * quad - logDet - 0.5 * z.length * Math.log(2 * Math.PI)
}

interface Fit {
  L: number[][]
  z: number[]
  ell: number
  noise: number
}

const LENGTH_SCALES = [0.1, 0.2, 0.35, 0.5, 0.8]
const NOISES = [1e-3, 1e-2, 1e-1]

/** The length scale and noise that explain the results best. */
function fitGp(X: number[][], y: number[], dims: number): Fit {
  let best: (Fit & { score: number }) | null = null
  for (const ell of LENGTH_SCALES) {
    for (const noise of NOISES) {
      const K = X.map((a, i) =>
        X.map((b, j) => kernel(a, b, dims, ell) + (i === j ? noise : 0)),
      )
      const L = cholesky(K)
      if (!L) continue
      const z = forwardSolve(L, y)
      const score = logMarginal(L, z)
      if (!best || score > best.score) best = { L, z, ell, noise, score }
    }
  }
  if (!best) throw new Error('The results could not be modelled.')
  return best
}

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - poly * Math.exp(-(x * x) / 2)
  return 0.5 * (1 + (x >= 0 ? erf : -erf))
}

interface Candidate {
  trial: TrialFactors
  x: number[]
  /** L⁻¹ k(x, training points), grown as picks are added. */
  v: number[]
  sumVZ: number
  sumVV: number
  taken: boolean
}

function expectedImprovement(
  mean: number,
  variance: number,
  best: number,
): number {
  const sd = Math.sqrt(Math.max(variance, 1e-12))
  const gain = mean - best - 0.01
  const z = gain / sd
  return gain * normalCdf(z) + sd * normalPdf(z)
}

function learn(
  space: Space,
  factors: readonly Factor[],
  X: number[][],
  scores: number[],
  observed: TrialFactors[],
  batchSize: number,
  random: Random,
): { trials: TrialFactors[]; ell: number; noise: number } {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const y = scores.map((s) => s - mean)
  const spread = Math.sqrt(y.reduce((a, b) => a + b * b, 0) / y.length) || 1
  const ys = y.map((v) => v / spread)
  const fit = fitGp(X, ys, space.dims)
  const { ell, noise } = fit
  const L = fit.L.map((row) => [...row])
  const z = [...fit.z]
  const best = Math.max(...ys)

  const seen = new Set(observed.map((t) => keyOf(t, factors)))
  const candidates: Candidate[] = []
  const pool = Math.max(500, 60 * space.dims)
  const add = (trial: TrialFactors) => {
    const key = keyOf(trial, factors)
    if (seen.has(key)) return
    seen.add(key)
    const x = space.encode(trial)
    const k = X.map((p) => kernel(x, p, space.dims, ell))
    const v = forwardSolve(L, k)
    let sumVZ = 0
    let sumVV = 0
    for (let i = 0; i < v.length; i++) {
      sumVZ += v[i] * z[i]
      sumVV += v[i] * v[i]
    }
    candidates.push({ trial, x, v, sumVZ, sumVV, taken: false })
  }
  for (let c = 0; c < pool; c++) add(space.sample(random))
  // Search around the best results too: that is where the gain usually is.
  const order = ys
    .map((value, i) => [value, i] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
  for (const [, i] of order)
    for (let c = 0; c < pool / 6; c++) add(space.nudge(observed[i], random))

  const picked: TrialFactors[] = []
  for (let pick = 0; pick < batchSize; pick++) {
    let chosen: Candidate | null = null
    let chosenScore = -Infinity
    for (const c of candidates) {
      if (c.taken) continue
      const ei = expectedImprovement(c.sumVZ, 1 - c.sumVV, best)
      if (ei > chosenScore) {
        chosen = c
        chosenScore = ei
      }
    }
    if (!chosen) break
    chosen.taken = true
    picked.push(chosen.trial)
    // Believe the prediction: add the pick as if its result had come back.
    const predicted = chosen.sumVZ
    const diagonal = Math.sqrt(
      Math.max(1 + noise - chosen.sumVV, 1e-9),
    )
    const row = [...chosen.v, diagonal]
    L.push(row)
    const zNew = (predicted - chosen.v.reduce((s, vi, i) => s + vi * z[i], 0)) / diagonal
    z.push(zNew)
    const pickedX = chosen.x
    for (const c of candidates) {
      if (c.taken) continue
      const kc = kernel(c.x, pickedX, space.dims, ell)
      const vNew =
        (kc - c.v.reduce((s, vi, i) => s + vi * chosen!.v[i], 0)) / diagonal
      c.v.push(vNew)
      c.sumVZ += vNew * zNew
      c.sumVV += vNew * vNew
    }
  }
  return { trials: picked, ell, noise }
}

/** The next batch of conditions. */
export function proposeBatch(input: ProposeInput): ProposeOutput {
  const { factors, objectives } = input
  if (factors.length === 0) throw new Error('The campaign has no factors.')
  if (input.batchSize < 1) throw new Error('The batch is empty.')
  const random = mulberry32(input.seed >>> 0)
  const space = buildSpace(factors)
  const recent = input.observations.slice(-MAX_LEARNED_OBSERVATIONS)
  const X = recent.map((o) => space.encode(o.factors))
  const scores = scoreObservations(objectives, recent)
  const varied = new Set(scores.map((s) => s.toFixed(9))).size > 1

  if (recent.length < MIN_OBSERVATIONS_TO_LEARN || !varied) {
    const trials = spaceFilling(space, factors, X, input.batchSize, random)
    return {
      trials,
      strategy: 'space-filling',
      note:
        recent.length === 0
          ? 'No results yet, so the batch covers the space as evenly as it can.'
          : 'Too few different results to learn from yet, so the batch keeps covering the space.',
    }
  }
  const { trials, ell, noise } = learn(
    space,
    factors,
    X,
    scores,
    recent.map((o) => o.factors),
    input.batchSize,
    random,
  )
  return {
    trials,
    strategy: 'expected-improvement',
    note: `Learned from ${recent.length} results; each condition is the one most likely to beat the best so far, given the others in the batch.`,
    lengthScale: ell,
    noise,
  }
}
