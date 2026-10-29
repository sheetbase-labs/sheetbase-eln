/**
 * Dose-response and standard-curve fitting: the four- and five-parameter
 * logistic (4PL, 5PL) fitted by Levenberg-Marquardt least squares.
 *
 *   4PL  y = D + (A − D) / (1 + (x / C)^B)
 *   5PL  y = D + (A − D) / (1 + (x / C)^B)^G
 *
 * A is the response at zero dose, D the response at infinite dose, C the
 * inflection (the EC50 in a 4PL), B the slope and G the asymmetry. B, C and G
 * are fitted on a log scale so they stay positive; a falling curve is simply
 * A > D. Pure functions: the same points always give the same fit.
 */
import { tCritical95 } from './stats'

export const CURVE_MODELS = ['4pl', '5pl'] as const
export type CurveModel = (typeof CURVE_MODELS)[number]

export const CURVE_PARAMETERS = ['A', 'B', 'C', 'D', 'G'] as const
export type CurveParameter = (typeof CURVE_PARAMETERS)[number]

export interface CurveParameters {
  /** Response at zero dose. */
  A: number
  /** Slope (Hill coefficient), always positive. */
  B: number
  /** Inflection point, in the units of x. */
  C: number
  /** Response at infinite dose. */
  D: number
  /** Asymmetry; 1 for a 4PL. */
  G: number
}

export interface CurveParameterEstimate {
  name: CurveParameter
  estimate: number
  /** Standard error on the parameter's own scale; null when not estimable. */
  se: number | null
  ci95: { lo: number; hi: number } | null
}

export interface CurveFit {
  model: CurveModel
  params: CurveParameters
  estimates: CurveParameterEstimate[]
  n: number
  /** Residual degrees of freedom, n − number of parameters. */
  dfResidual: number
  sse: number
  r2: number
  rmse: number
  /** Residual standard error; null with no residual degrees of freedom. */
  sigma: number | null
  /** Dose giving the response halfway between the two asymptotes. */
  ec50: number
  ec50Ci95: { lo: number; hi: number } | null
  /** True when the response falls as the dose rises (an IC50 curve). */
  falling: boolean
  iterations: number
  converged: boolean
  residuals: number[]
}

const PARAMETER_COUNT: Record<CurveModel, number> = { '4pl': 4, '5pl': 5 }

/** The curve's response at dose x. */
export function curveValue(
  params: CurveParameters,
  x: number,
  model: CurveModel = '4pl',
): number {
  const { A, B, C, D, G } = params
  const ratio = (x / C) ** B
  const denominator = model === '5pl' ? (1 + ratio) ** G : 1 + ratio
  return D + (A - D) / denominator
}

/**
 * The dose that gives response y, or null when y is not strictly between the
 * curve's two asymptotes (there is no dose that produces it).
 */
export function curveInverse(
  params: CurveParameters,
  y: number,
  model: CurveModel = '4pl',
): number | null {
  const { A, B, C, D, G } = params
  if (!Number.isFinite(y) || y === D) return null
  const span = (A - D) / (y - D)
  if (!(span > 1)) return null
  const inner = model === '5pl' ? span ** (1 / G) - 1 : span - 1
  if (!(inner > 0)) return null
  const x = C * inner ** (1 / B)
  return Number.isFinite(x) ? x : null
}

/** The dose halfway between the asymptotes: C·(2^(1/G) − 1)^(1/B). */
export function curveEc50(
  params: CurveParameters,
  model: CurveModel = '4pl',
): number {
  const { B, C, G } = params
  return model === '5pl' ? C * (2 ** (1 / G) - 1) ** (1 / B) : C
}

// ---------------------------------------------------------------------------
// Fitting
// ---------------------------------------------------------------------------

function paramsFromTheta(t: number[], model: CurveModel): CurveParameters {
  return {
    A: t[0],
    B: Math.exp(t[1]),
    C: Math.exp(t[2]),
    D: t[3],
    G: model === '5pl' ? Math.exp(t[4]) : 1,
  }
}

function predict(t: number[], xs: number[], model: CurveModel): number[] {
  const params = paramsFromTheta(t, model)
  return xs.map((x) => curveValue(params, x, model))
}

function sumSquares(ys: number[], fitted: number[]): number {
  let sse = 0
  for (let i = 0; i < ys.length; i++) sse += (ys[i] - fitted[i]) ** 2
  return Number.isFinite(sse) ? sse : Number.POSITIVE_INFINITY
}

/** Central-difference Jacobian of the model in θ, one row per point. */
function jacobian(t: number[], xs: number[], model: CurveModel): number[][] {
  const rows = xs.map(() => new Array<number>(t.length).fill(0))
  for (let j = 0; j < t.length; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(t[j]))
    const up = t.slice()
    const down = t.slice()
    up[j] += h
    down[j] -= h
    const a = predict(up, xs, model)
    const b = predict(down, xs, model)
    for (let i = 0; i < xs.length; i++) rows[i][j] = (a[i] - b[i]) / (2 * h)
  }
  return rows
}

function normalMatrix(J: number[][]): number[][] {
  const p = J[0].length
  const m = Array.from({ length: p }, () => new Array<number>(p).fill(0))
  for (const row of J)
    for (let a = 0; a < p; a++)
      for (let b = 0; b < p; b++) m[a][b] += row[a] * row[b]
  return m
}

/** Solves M·x = v by Gaussian elimination with partial pivoting. */
function solve(M: number[][], v: number[]): number[] | null {
  const p = v.length
  const a = M.map((row, i) => [...row, v[i]])
  for (let col = 0; col < p; col++) {
    let pivot = col
    for (let r = col + 1; r < p; r++)
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    if (Math.abs(a[pivot][col]) < 1e-300) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    for (let r = col + 1; r < p; r++) {
      const f = a[r][col] / a[col][col]
      for (let c = col; c <= p; c++) a[r][c] -= f * a[col][c]
    }
  }
  const x = new Array<number>(p).fill(0)
  for (let r = p - 1; r >= 0; r--) {
    let acc = a[r][p]
    for (let c = r + 1; c < p; c++) acc -= a[r][c] * x[c]
    x[r] = acc / a[r][r]
  }
  return x.every(Number.isFinite) ? x : null
}

function invert(M: number[][]): number[][] | null {
  const p = M.length
  const columns: number[][] = []
  for (let c = 0; c < p; c++) {
    const e = new Array<number>(p).fill(0)
    e[c] = 1
    const col = solve(M, e)
    if (!col) return null
    columns.push(col)
  }
  return M.map((_, r) => columns.map((col) => col[r]))
}

interface Attempt {
  theta: number[]
  sse: number
  iterations: number
  converged: boolean
}

function levenbergMarquardt(
  start: number[],
  xs: number[],
  ys: number[],
  model: CurveModel,
): Attempt {
  let t = start.slice()
  let sse = sumSquares(ys, predict(t, xs, model))
  let lambda = 1e-3
  let converged = false
  let iterations = 0
  for (; iterations < 300; iterations++) {
    const fitted = predict(t, xs, model)
    const residual = ys.map((y, i) => y - fitted[i])
    const J = jacobian(t, xs, model)
    const JtJ = normalMatrix(J)
    const Jtr = t.map((_, j) =>
      J.reduce((acc, row, i) => acc + row[j] * residual[i], 0),
    )
    let improved = false
    for (let tries = 0; tries < 12; tries++) {
      const damped = JtJ.map((row, a) =>
        row.map((value, b) =>
          a === b ? value + lambda * Math.max(value, 1e-12) : value,
        ),
      )
      const step = solve(damped, Jtr)
      if (step) {
        const next = t.map((value, j) => value + step[j])
        const nextSse = sumSquares(ys, predict(next, xs, model))
        if (nextSse < sse) {
          const relative = (sse - nextSse) / Math.max(sse, 1e-300)
          const size = Math.max(
            ...step.map((s, j) => Math.abs(s) / (1 + Math.abs(t[j]))),
          )
          t = next
          sse = nextSse
          lambda = Math.max(lambda / 4, 1e-12)
          improved = true
          if (relative < 1e-12 || size < 1e-9 || sse < 1e-24) converged = true
          break
        }
      }
      lambda *= 4
    }
    if (!improved) {
      // No damped step lowers the error: this is a minimum.
      converged = true
      break
    }
    if (converged) break
  }
  return { theta: t, sse, iterations, converged }
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** A few sensible starting curves; the best fit of them all is kept. */
function startingPoints(
  xs: number[],
  ys: number[],
  model: CurveModel,
): number[][] {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b])
  const lowCount = Math.max(1, Math.floor(order.length / 4))
  const mean = (idx: number[]) =>
    idx.reduce((acc, i) => acc + ys[i], 0) / idx.length
  const low = mean(order.slice(0, lowCount))
  const high = mean(order.slice(order.length - lowCount))
  const span = Math.max(Math.abs(high - low), 1e-9)
  const pad = 0.05 * span
  const rising = high >= low
  const A = rising ? low - pad : low + pad
  const D = rising ? high + pad : high - pad
  const logs = xs.map((x) => Math.log(x)).sort((a, b) => a - b)
  const centres = [
    median(logs),
    logs[Math.floor(logs.length / 4)],
    logs[Math.floor((3 * logs.length) / 4)],
  ]
  const starts: number[][] = []
  for (const centre of centres)
    for (const B of [0.7, 1.5, 3]) {
      const t = [A, Math.log(B), centre, D]
      if (model === '5pl') t.push(0)
      starts.push(t)
    }
  return starts
}

/**
 * Fits a 4PL or 5PL to dose–response points. Every x must be positive. Returns
 * null when there are too few points for the model or no start converges to a
 * finite curve.
 */
export function fitCurve(
  xs: number[],
  ys: number[],
  model: CurveModel,
): CurveFit | null {
  const p = PARAMETER_COUNT[model]
  const n = xs.length
  if (n < p || ys.length !== n) return null
  if (xs.some((x) => !(x > 0) || !Number.isFinite(x))) return null
  if (ys.some((y) => !Number.isFinite(y))) return null

  let best: Attempt | null = null
  for (const start of startingPoints(xs, ys, model)) {
    const attempt = levenbergMarquardt(start, xs, ys, model)
    if (!Number.isFinite(attempt.sse)) continue
    if (!best || attempt.sse < best.sse - 1e-12 * Math.max(1, best.sse))
      best = attempt
  }
  if (!best) return null

  const params = paramsFromTheta(best.theta, model)
  const fitted = predict(best.theta, xs, model)
  const residuals = ys.map((y, i) => y - fitted[i])
  const meanY = ys.reduce((acc, y) => acc + y, 0) / n
  const sst = ys.reduce((acc, y) => acc + (y - meanY) ** 2, 0)
  const dfResidual = n - p
  const sigma = dfResidual > 0 ? Math.sqrt(best.sse / dfResidual) : null

  // Parameter covariance in θ: σ²·(JᵀJ)⁻¹.
  let covariance: number[][] | null = null
  if (sigma !== null) {
    const inverse = invert(normalMatrix(jacobian(best.theta, xs, model)))
    if (inverse)
      covariance = inverse.map((row) => row.map((v) => v * sigma ** 2))
    if (covariance && covariance.some((row, i) => !(row[i] >= 0)))
      covariance = null
  }
  const tCrit = dfResidual > 0 ? tCritical95(dfResidual) : Number.NaN
  const se = (j: number) => (covariance ? Math.sqrt(covariance[j][j]) : null)

  const estimates: CurveParameterEstimate[] = CURVE_PARAMETERS.filter(
    (name) => model === '5pl' || name !== 'G',
  ).map((name) => {
    const j = { A: 0, B: 1, C: 2, D: 3, G: 4 }[name]
    const estimate = params[name]
    const seTheta = se(j)
    if (seTheta === null) return { name, estimate, se: null, ci95: null }
    // B, C and G are fitted on a log scale: delta method for the standard
    // error, and an interval that is symmetric on that scale.
    if (name === 'A' || name === 'D')
      return {
        name,
        estimate,
        se: seTheta,
        ci95: {
          lo: estimate - tCrit * seTheta,
          hi: estimate + tCrit * seTheta,
        },
      }
    return {
      name,
      estimate,
      se: estimate * seTheta,
      ci95: {
        lo: estimate * Math.exp(-tCrit * seTheta),
        hi: estimate * Math.exp(tCrit * seTheta),
      },
    }
  })

  const ec50 = curveEc50(params, model)
  let ec50Ci95: CurveFit['ec50Ci95'] = null
  if (covariance) {
    // ln EC50 as a function of θ, by central differences, then the delta method.
    const lnEc50 = (t: number[]) =>
      Math.log(curveEc50(paramsFromTheta(t, model), model))
    const gradient = best.theta.map((value, j) => {
      const h = 1e-6 * Math.max(1, Math.abs(value))
      const up = best.theta.slice()
      const down = best.theta.slice()
      up[j] += h
      down[j] -= h
      return (lnEc50(up) - lnEc50(down)) / (2 * h)
    })
    let variance = 0
    for (let a = 0; a < gradient.length; a++)
      for (let b = 0; b < gradient.length; b++)
        variance += gradient[a] * covariance[a][b] * gradient[b]
    if (variance >= 0 && Number.isFinite(tCrit)) {
      const half = tCrit * Math.sqrt(variance)
      ec50Ci95 = { lo: ec50 * Math.exp(-half), hi: ec50 * Math.exp(half) }
    }
  }

  return {
    model,
    params,
    estimates,
    n,
    dfResidual,
    sse: best.sse,
    r2: sst > 0 ? 1 - best.sse / sst : 1,
    rmse: Math.sqrt(best.sse / n),
    sigma,
    ec50,
    ec50Ci95,
    falling: params.A > params.D,
    iterations: best.iterations,
    converged: best.converged,
    residuals,
  }
}

/** Points along the fitted curve, evenly spaced on a log dose axis. */
export function curvePoints(
  params: CurveParameters,
  model: CurveModel,
  range: { min: number; max: number },
  count = 80,
): Array<{ x: number; y: number }> {
  const lo = Math.log(range.min)
  const hi = Math.log(range.max)
  if (!(hi > lo))
    return [{ x: range.min, y: curveValue(params, range.min, model) }]
  return Array.from({ length: count }, (_, i) => {
    const x = Math.exp(lo + ((hi - lo) * i) / (count - 1))
    return { x, y: curveValue(params, x, model) }
  })
}
