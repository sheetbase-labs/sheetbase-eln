/**
 * SCI-02 — small deterministic statistics kernel.
 *
 * Deliberately narrow (the roadmap forbids a giant statistical package):
 * the descriptive summaries, linear-interpolation quantiles and ordinary
 * least-squares algebra the analysis framework needs. Every function is
 * pure, environment-independent (no locale-dependent sorting/formatting)
 * and mirrors the SQL implementations used by server-side materialisation,
 * so a rerun of the same inputs produces the same numbers everywhere.
 */

/** Linear-interpolation quantile on an ascending-sorted array (p·(n−1)). */
export function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const h = (sorted.length - 1) * p
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo)
}

/** Ascending numeric sort (codepoint-stable, environment-independent). */
export function sortNumbers(values: number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

export interface SummaryStats {
  n: number
  mean: number
  /** Sample standard deviation (n−1 denominator); null when n < 2. */
  sd: number | null
  /** Standard error of the mean; null when n < 2. */
  se: number | null
  min: number
  q1: number
  median: number
  q3: number
  max: number
}

export function summaryStats(values: number[]): SummaryStats | null {
  if (values.length === 0) return null
  const sorted = sortNumbers(values)
  const n = sorted.length
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  const mean = sum / n
  let sd: number | null = null
  if (n >= 2) {
    const ss = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0)
    sd = Math.sqrt(ss / (n - 1))
  }
  return {
    n,
    mean,
    sd,
    se: sd === null ? null : sd / Math.sqrt(n),
    min: sorted[0],
    q1: quantileSorted(sorted, 0.25),
    median: quantileSorted(sorted, 0.5),
    q3: quantileSorted(sorted, 0.75),
    max: sorted[n - 1],
  }
}

/**
 * Ordinary least squares fit of y against the basis [1, x, x², … x^degree].
 *
 * The predictor is centred on its mean and scaled by its standard deviation
 * before the normal equations are formed. Raw-x Vandermonde matrices square
 * an already bad condition number — predictors like 100000, 100001, … make
 * x⁴ columns ~10²⁰ and the fit silently garbage. In scaled coordinates the
 * same data is well-conditioned for every degree the validator allows
 * (1–4); the solved coefficients are then expanded back to raw-x
 * coefficients via the binomial theorem so callers only ever see raw-space
 * polynomials.
 *
 * Returns null when the system is singular (fewer observations than
 * coefficients, zero predictor variance, or elimination meets a pivot
 * below 1e-12 in scaled space).
 */
export function olsFit(
  xs: number[],
  ys: number[],
  degree: number,
): { coefficients: number[] } | null {
  if (xs.length !== ys.length) return null
  const n = xs.length
  const size = degree + 1
  if (n < size) return null

  // Centre and scale: t = (x − μ) / σ (population std). A constant
  // predictor has zero variance → no unique fit beyond the intercept.
  const mean = xs.reduce((acc, v) => acc + v, 0) / n
  const variance = xs.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n
  const scale = Math.sqrt(variance)
  if (!Number.isFinite(mean) || !Number.isFinite(scale)) return null
  if (size > 1 && scale < Number.EPSILON * Math.max(1, Math.abs(mean)))
    return null
  const ts = size > 1 ? xs.map((v) => (v - mean) / scale) : xs

  // Normal equations: (XᵀX) β = Xᵀy with Vandermonde X over t.
  const ata: number[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => 0),
  )
  const atb: number[] = Array.from({ length: size }, () => 0)
  for (let i = 0; i < n; i++) {
    const power = [1]
    for (let d = 1; d < size; d++) power.push(power[d - 1] * ts[i])
    for (let r = 0; r < size; r++) {
      atb[r] += power[r] * ys[i]
      for (let cIdx = 0; cIdx < size; cIdx++) {
        ata[r][cIdx] += power[r] * power[cIdx]
      }
    }
  }

  // Gaussian elimination with partial pivoting on the augmented matrix.
  const aug: number[][] = ata.map((row, i) => [...row, atb[i]])
  for (let col = 0; col < size; col++) {
    let pivotRow = col
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivotRow][col])) pivotRow = row
    }
    if (
      !Number.isFinite(aug[pivotRow][col]) ||
      Math.abs(aug[pivotRow][col]) < 1e-12
    )
      return null
    ;[aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]]
    for (let row = col + 1; row < size; row++) {
      const factor = aug[row][col] / aug[col][col]
      for (let k = col; k <= size; k++) aug[row][k] -= factor * aug[col][k]
    }
  }
  const betaT = Array.from({ length: size }, () => 0)
  for (let row = size - 1; row >= 0; row--) {
    let acc = aug[row][size]
    for (let k = row + 1; k < size; k++) acc -= aug[row][k] * betaT[k]
    betaT[row] = acc / aug[row][row]
  }

  if (size === 1) return { coefficients: betaT }

  // Expand p(t) with t = (x − μ)/σ back into raw-x coefficients:
  // β_k·((x−μ)/σ)^k = β_k·σ^(−k)·Σ_j C(k,j)·x^j·(−μ)^(k−j).
  const coefficients = Array.from({ length: size }, () => 0)
  for (let k = 0; k < size; k++) {
    let binomial = 1
    const powerScale = scale ** k
    for (let j = 0; j <= k; j++) {
      coefficients[j] += (betaT[k] * binomial * (-mean) ** (k - j)) / powerScale
      binomial = (binomial * (k - j)) / (j + 1)
    }
  }
  return { coefficients }
}

export function polyEval(coefficients: number[], x: number): number {
  let acc = 0
  for (let d = coefficients.length - 1; d >= 0; d--) {
    acc = acc * x + coefficients[d]
  }
  return acc
}

export interface FitQuality {
  r2: number
  rmse: number
}

export function fitQuality(
  xs: number[],
  ys: number[],
  coefficients: number[],
): FitQuality {
  const n = xs.length
  const meanY = ys.reduce((acc, v) => acc + v, 0) / n
  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    const predicted = polyEval(coefficients, xs[i])
    ssRes += (ys[i] - predicted) ** 2
    ssTot += (ys[i] - meanY) ** 2
  }
  return {
    r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    rmse: Math.sqrt(ssRes / n),
  }
}
