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
 * Solved via the normal equations with Gaussian elimination; degrees above
 * four are rejected by the analysis-definition validator because condition
 * numbers degrade quickly beyond that.
 *
 * Returns null when the system is singular (e.g. constant predictor).
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

  // Normal equations: (XᵀX) β = Xᵀy with Vandermonde X.
  const ata: number[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => 0),
  )
  const atb: number[] = Array.from({ length: size }, () => 0)
  for (let i = 0; i < n; i++) {
    const power = [1]
    for (let d = 1; d < size; d++) power.push(power[d - 1] * xs[i])
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
    if (Math.abs(aug[pivotRow][col]) < 1e-12) return null
    ;[aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]]
    for (let row = col + 1; row < size; row++) {
      const factor = aug[row][col] / aug[col][col]
      for (let k = col; k <= size; k++) aug[row][k] -= factor * aug[col][k]
    }
  }
  const beta = Array.from({ length: size }, () => 0)
  for (let row = size - 1; row >= 0; row--) {
    let acc = aug[row][size]
    for (let k = row + 1; k < size; k++) acc -= aug[row][k] * beta[k]
    beta[row] = acc / aug[row][row]
  }
  return { coefficients: beta }
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
