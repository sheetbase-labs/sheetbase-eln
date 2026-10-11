/**
 * SCI-02 — small deterministic statistics kernel; R5-STUDIO-01 — linear-model
 * inference and assumption tests.
 *
 * Deliberately narrow (the roadmap forbids a giant statistical package): the
 * descriptive summaries, linear-interpolation quantiles, ordinary
 * least-squares algebra and the sampling distributions its p-values need.
 * Every function is pure, environment-independent (no locale-dependent
 * sorting or formatting) and returns null — never a fabricated number — when
 * the statistic is undefined for the data at hand.
 *
 * This module is the single authority for every quantity an analysis reports:
 * the live studio and frozen-evidence reconstruction both execute it, so a
 * rerun over the same rows reproduces the same numbers, intervals and
 * p-values. `analysisMethod()` in `analysis-definition.ts` names the method
 * and its runner; the R5-STUDIO-01 decision (see the commit that introduced
 * it) records why the computation stays in this shared kernel instead of a
 * server-side statistics runtime.
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

// ---------------------------------------------------------------------------
// Special functions — deterministic, dependency-free
//
// R5-STUDIO-01: a least-squares fit that states its method needs the sampling
// distributions behind its p-values. Rather than pulling a statistics package
// into the bundle (the roadmap forbids a browser statistics engine), the two
// functions every t and F p-value reduces to are implemented here: the
// Lanczos log-gamma and its continued-fraction incomplete beta. χ² with two
// degrees of freedom — the only χ² this kernel reports (Jarque–Bera,
// Breusch–Pagan) — is exp(−x/2) in closed form.
// ---------------------------------------------------------------------------

/** Lanczos g = 7 coefficients (standard 9-term set). */
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
] as const

/** Natural logarithm of the gamma function (Lanczos approximation). */
export function logGamma(x: number): number {
  if (!(x > 0)) return Number.NaN
  if (x < 0.5) {
    // Reflection: Γ(x)Γ(1−x) = π / sin(πx).
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  }
  const z = x - 1
  const t = z + 7.5
  let series = LANCZOS_COEFFICIENTS[0]
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i++)
    series += LANCZOS_COEFFICIENTS[i] / (z + i)
  return (
    0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(series)
  )
}

/** Continued fraction for the incomplete beta (Lentz's method). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 300
  const epsilon = 3e-14
  const tiny = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m
    let numerator = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + numerator * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + numerator / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    numerator = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + numerator * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + numerator / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < epsilon) break
  }
  return h
}

/** Regularized incomplete beta function I_x(a, b) for a, b > 0. */
export function regularizedIncompleteBeta(
  a: number,
  b: number,
  x: number,
): number {
  if (!(a > 0) || !(b > 0) || !Number.isFinite(x)) return Number.NaN
  if (x <= 0) return 0
  if (x >= 1) return 1
  const logBeta =
    logGamma(a + b) -
    logGamma(a) -
    logGamma(b) +
    a * Math.log(x) +
    b * Math.log(1 - x)
  const front = Math.exp(logBeta)
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b
}

/**
 * Two-sided p-value of a Student t statistic: the tail probability the
 * reported coefficient estimates are tested against.
 */
export function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || !(df > 0)) return Number.NaN
  return regularizedIncompleteBeta(df / 2, 0.5, df / (df + t * t))
}

/** Upper-tail p-value of an F statistic with (df1, df2) degrees of freedom. */
export function fUpperP(f: number, df1: number, df2: number): number {
  if (!(f >= 0) || !(df1 > 0) || !(df2 > 0) || !Number.isFinite(f))
    return Number.NaN
  if (f === 0) return 1
  return regularizedIncompleteBeta(df2 / 2, df1 / 2, df2 / (df2 + df1 * f))
}

/**
 * Upper-tail p-value of a χ² statistic with two degrees of freedom. Every
 * two-df test in this kernel (Jarque–Bera normality, Breusch–Pagan
 * heteroscedasticity) reduces to exp(−x/2) exactly.
 */
export function chiSquare2UpperP(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN
  return x <= 0 ? 1 : Math.exp(-x / 2)
}

/**
 * Ordinary least squares fit with full linear-model inference.
 *
 * Fit of y against the basis [1, x, x², … x^degree].
 *
 * The predictor is centred on its mean and scaled by its standard deviation
 * before the normal equations are formed. Raw-x Vandermonde matrices square
 * an already bad condition number — predictors like 100000, 100001, … make
 * x⁴ columns ~10²⁰ and the fit silently garbage. In scaled coordinates the
 * same data is well-conditioned for every degree the validator allows
 * (1–4); the solved coefficients are then expanded back to raw-x
 * coefficients via the binomial theorem, and the coefficient covariance is
 * carried through the same change of basis, so standard errors, intervals
 * and p-values describe the coefficients the caller actually reports.
 *
 * Returns null when the system is singular (fewer observations than
 * coefficients, zero predictor variance, or elimination meets a pivot
 * below 1e-12 in scaled space).
 */
export interface LinearModelFit {
  /** Raw-x-space coefficients, lowest order first. */
  coefficients: number[]
  /** Raw-x-space coefficient covariance ((degree+1)²); NaN without residual df. */
  covariance: number[][]
  /** Residual standard error; null when there is no residual df. */
  sigma: number | null
  /** n − (degree + 1). */
  dfResidual: number
  r2: number
  /** Adjusted R²; null when there is no residual df. */
  adjR2: number | null
  rmse: number
  /** Overall F for every non-intercept term; null when not estimable. */
  f: number | null
  fP: number | null
  /** Hat values (leverage), in observation order. */
  leverage: number[]
  /** Residuals y − ŷ, in observation order. */
  residuals: number[]
  /** Largest Cook's distance; null when no residual df or a perfect fit. */
  maxCooksDistance: number | null
}

export function olsFitWithInference(
  xs: number[],
  ys: number[],
  degree: number,
): LinearModelFit | null {
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

  let coefficients: number[]
  if (size === 1) {
    coefficients = betaT
  } else {
    // Expand p(t) with t = (x − μ)/σ back into raw-x coefficients:
    // β_k·((x−μ)/σ)^k = β_k·σ^(−k)·Σ_j C(k,j)·x^j·(−μ)^(k−j).
    const expanded = Array.from({ length: size }, () => 0)
    for (let k = 0; k < size; k++) {
      let binomial = 1
      const powerScale = scale ** k
      for (let j = 0; j <= k; j++) {
        expanded[j] += (betaT[k] * binomial * (-mean) ** (k - j)) / powerScale
        binomial = (binomial * (k - j)) / (j + 1)
      }
    }
    coefficients = expanded
  }

  // (TᵀT)⁻¹ supplies leverage and — through the same change of basis — the
  // covariance of the *reported* raw-x coefficients.
  const ataInverse = invertMatrix(ata)
  if (!ataInverse) return null

  const leverage = Array.from({ length: n }, (_, i) => {
    const power = [1]
    for (let d = 1; d < size; d++) power.push(power[d - 1] * ts[i])
    let h = 0
    for (let r = 0; r < size; r++) {
      let acc = 0
      for (let cIdx = 0; cIdx < size; cIdx++)
        acc += ataInverse[r][cIdx] * power[cIdx]
      h += power[r] * acc
    }
    return h
  })

  const residuals = xs.map((x, i) => ys[i] - polyEval(coefficients, x))
  let ssRes = 0
  for (const e of residuals) ssRes += e * e
  const meanY = ys.reduce((acc, v) => acc + v, 0) / n
  let ssTot = 0
  for (const y of ys) ssTot += (y - meanY) ** 2

  // fitQuality stays the single authority for R² and RMSE.
  const quality = fitQuality(xs, ys, coefficients)
  const dfResidual = n - size
  const sigma = dfResidual >= 1 ? Math.sqrt(ssRes / dfResidual) : null
  const adjR2 =
    dfResidual >= 1 ? 1 - (1 - quality.r2) * ((n - 1) / dfResidual) : null

  let f: number | null = null
  let fP: number | null = null
  const dfModel = size - 1
  if (dfModel >= 1 && dfResidual >= 1 && ssRes > 0 && ssTot > 0) {
    f = (ssTot - ssRes) / dfModel / (ssRes / dfResidual)
    fP = fUpperP(f, dfModel, dfResidual)
  }

  const sigmaSquared = dfResidual >= 1 ? ssRes / dfResidual : null
  let maxCooksDistance: number | null = null
  if (sigmaSquared !== null && sigmaSquared > 0) {
    let worst = 0
    for (let i = 0; i < n; i++) {
      const h = leverage[i]
      if (!(h < 1)) continue
      const distance =
        (residuals[i] ** 2 / (size * sigmaSquared)) * (h / (1 - h) ** 2)
      if (distance > worst) worst = distance
    }
    maxCooksDistance = worst
  }

  let covariance: number[][]
  if (sigmaSquared === null) {
    covariance = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => Number.NaN),
    )
  } else if (size === 1) {
    covariance = [[sigmaSquared * ataInverse[0][0]]]
  } else {
    // basis[j][k] is the coefficient of x^j contributed by the scaled term t^k.
    const basis = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => 0),
    )
    for (let k = 0; k < size; k++) {
      let binomial = 1
      const powerScale = scale ** k
      for (let j = 0; j <= k; j++) {
        basis[j][k] = (binomial * (-mean) ** (k - j)) / powerScale
        binomial = (binomial * (k - j)) / (j + 1)
      }
    }
    covariance = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => 0),
    )
    for (let i = 0; i < size; i++) {
      for (let l = 0; l < size; l++) {
        let acc = 0
        for (let k = 0; k < size; k++) {
          for (let j = 0; j < size; j++) {
            acc += basis[i][k] * sigmaSquared * ataInverse[k][j] * basis[l][j]
          }
        }
        covariance[i][l] = acc
      }
    }
  }

  return {
    coefficients,
    covariance,
    sigma,
    dfResidual,
    r2: quality.r2,
    adjR2,
    rmse: quality.rmse,
    f,
    fP,
    leverage,
    residuals,
    maxCooksDistance,
  }
}

/** Invert a square matrix by Gauss–Jordan elimination; null when singular. */
function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length
  const aug = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ])
  for (let col = 0; col < n; col++) {
    let pivotRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivotRow][col])) pivotRow = row
    }
    if (
      !Number.isFinite(aug[pivotRow][col]) ||
      Math.abs(aug[pivotRow][col]) < 1e-12
    )
      return null
    ;[aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]]
    const pivot = aug[col][col]
    for (let k = col; k < 2 * n; k++) aug[col][k] /= pivot
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      if (factor === 0) continue
      for (let k = col; k < 2 * n; k++) aug[row][k] -= factor * aug[col][k]
    }
  }
  return aug.map((row) => row.slice(n))
}

/**
 * Coefficients only, for callers that fit a curve and report no inference
 * (the chart fit overlay). Inference callers use `olsFitWithInference`.
 */
export function olsFit(
  xs: number[],
  ys: number[],
  degree: number,
): { coefficients: number[] } | null {
  const fit = olsFitWithInference(xs, ys, degree)
  return fit ? { coefficients: fit.coefficients } : null
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

/**
 * Two-tailed 95% Student t critical value. Lookup is coarse and
 * deterministic so interval overlays do not depend on a stats package.
 */
export function tCritical95(df: number): number {
  if (df < 1) return Number.NaN
  if (df === 1) return 12.706
  if (df === 2) return 4.303
  if (df === 3) return 3.182
  if (df === 4) return 2.776
  if (df === 5) return 2.571
  if (df < 10) return 2.365
  if (df < 15) return 2.145
  if (df < 20) return 2.093
  if (df < 30) return 2.045
  if (df < 60) return 2.0
  if (df < 120) return 1.98
  return 1.96
}

/** Mean ± t·SEM two-sided 95% interval. Null when n < 2. */
export function meanConfidenceInterval(values: number[]): {
  lo: number
  hi: number
  mean: number
  n: number
} | null {
  const stats = summaryStats(values)
  if (!stats || stats.se === null) return null
  const t = tCritical95(stats.n - 1)
  return {
    mean: stats.mean,
    n: stats.n,
    lo: stats.mean - t * stats.se,
    hi: stats.mean + t * stats.se,
  }
}

/**
 * 95% confidence band of the fitted mean for a degree-1 OLS line.
 * Higher-degree bands are omitted: the interval formula used here is the
 * standard linear-model mean band, not a general polynomial band.
 */
export function linearMeanConfidenceBand(
  xs: number[],
  ys: number[],
  sampleXs: number[],
): Array<{ x: number; lo: number; hi: number; yHat: number }> | null {
  if (xs.length !== ys.length || xs.length < 3) return null
  const fit = olsFit(xs, ys, 1)
  if (!fit) return null
  const n = xs.length
  const meanX = xs.reduce((acc, v) => acc + v, 0) / n
  let sxx = 0
  let ssRes = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - meanX) ** 2
    const predicted = polyEval(fit.coefficients, xs[i])
    ssRes += (ys[i] - predicted) ** 2
  }
  if (sxx <= 0) return null
  const sigma = Math.sqrt(ssRes / (n - 2))
  const t = tCritical95(n - 2)
  return sampleXs.map((x) => {
    const yHat = polyEval(fit.coefficients, x)
    const se = sigma * Math.sqrt(1 / n + (x - meanX) ** 2 / sxx)
    return { x, lo: yHat - t * se, hi: yHat + t * se, yHat }
  })
}

// ---------------------------------------------------------------------------
// One-way ANOVA and residual diagnostics (R5-STUDIO-01)
//
// All of these are closed-form, so a method statement can name exactly what
// was tested. Where a test is undefined for the data at hand the function
// returns null rather than a fabricated number; the caller reports the check
// as not run instead of guessing.
// ---------------------------------------------------------------------------

export interface OneWayAnovaGroupStat {
  group: string
  n: number
  mean: number
  sd: number | null
  se: number | null
  /** Two-sided 95% confidence interval of the group mean; null when n < 2. */
  ci95: { lo: number; hi: number } | null
}

export interface OneWayAnovaResult {
  groups: OneWayAnovaGroupStat[]
  /** Total observations across the non-empty groups. */
  n: number
  grandMean: number
  ssBetween: number
  ssWithin: number
  dfBetween: number
  dfWithin: number
  msBetween: number
  msWithin: number
  /** F statistic for equal group means. */
  f: number
  /** Upper-tail p-value of F. */
  p: number
  /** η² = SS_between / SS_total. */
  etaSquared: number
}

/**
 * One-way fixed-effects analysis of variance over pre-grouped values.
 *
 * Returns null when the F test is undefined: fewer than two non-empty
 * groups, no within-group residual degrees of freedom (N − k < 1), or zero
 * within-group variance (every group perfectly constant). The caller then
 * reports the check as not run, never as a pass.
 */
export function oneWayAnova(
  groups: Array<{ group: string; values: number[] }>,
): OneWayAnovaResult | null {
  const used = groups.filter((entry) => entry.values.length > 0)
  if (used.length < 2) return null
  const k = used.length
  const n = used.reduce((acc, entry) => acc + entry.values.length, 0)
  const dfWithin = n - k
  if (dfWithin < 1) return null

  const grandMean =
    used.reduce(
      (acc, entry) => acc + entry.values.reduce((s, v) => s + v, 0),
      0,
    ) / n

  let ssBetween = 0
  let ssWithin = 0
  const groupStats: OneWayAnovaGroupStat[] = []
  for (const entry of used) {
    const stats = summaryStats(entry.values)!
    ssBetween += stats.n * (stats.mean - grandMean) ** 2
    if (stats.sd !== null) ssWithin += (stats.n - 1) * stats.sd * stats.sd
    const interval = meanConfidenceInterval(entry.values)
    groupStats.push({
      group: entry.group,
      n: stats.n,
      mean: stats.mean,
      sd: stats.sd,
      se: stats.se,
      ci95: interval ? { lo: interval.lo, hi: interval.hi } : null,
    })
  }

  const dfBetween = k - 1
  const msBetween = ssBetween / dfBetween
  const msWithin = ssWithin / dfWithin
  if (!(msWithin > 0)) return null
  const f = msBetween / msWithin
  const ssTotal = ssBetween + ssWithin
  return {
    groups: groupStats,
    n,
    grandMean,
    ssBetween,
    ssWithin,
    dfBetween,
    dfWithin,
    msBetween,
    msWithin,
    f,
    p: fUpperP(f, dfBetween, dfWithin),
    etaSquared: ssTotal === 0 ? 0 : ssBetween / ssTotal,
  }
}

export interface NormalityTestResult {
  /** Jarque–Bera statistic (χ² with 2 df). */
  statistic: number
  p: number
  skewness: number
  /** Excess kurtosis (m₄/m₂² − 3). */
  excessKurtosis: number
  n: number
}

/**
 * Jarque–Bera test of normality: n/6·(S² + (K−3)²/4) against χ²(2).
 * Returns null below eight observations, where the asymptotic test says
 * nothing trustworthy.
 */
export function jarqueBeraTest(values: number[]): NormalityTestResult | null {
  const n = values.length
  if (n < 8) return null
  const mean = values.reduce((acc, v) => acc + v, 0) / n
  let m2 = 0
  let m3 = 0
  let m4 = 0
  for (const v of values) {
    const d = v - mean
    m2 += d * d
    m3 += d ** 3
    m4 += d ** 4
  }
  m2 /= n
  m3 /= n
  m4 /= n
  if (!(m2 > 0)) return null
  const skewness = m3 / m2 ** 1.5
  const excessKurtosis = m4 / (m2 * m2) - 3
  const statistic = (n / 6) * (skewness * skewness + excessKurtosis ** 2 / 4)
  return {
    statistic,
    p: chiSquare2UpperP(statistic),
    skewness,
    excessKurtosis,
    n,
  }
}

export interface HeteroscedasticityTestResult {
  /** Breusch–Pagan LM statistic (n·R² of the auxiliary regression). */
  statistic: number
  df: number
  p: number
}

/**
 * Breusch–Pagan test against the fitted values: regress the squared
 * residuals on the fitted values and report n·R² as χ²(1). Returns null when
 * there is nothing to test — fewer than three observations, constant fitted
 * values, or constant squared residuals (a perfect fit).
 */
export function breuschPaganTest(
  fitted: number[],
  residuals: number[],
): HeteroscedasticityTestResult | null {
  const n = fitted.length
  if (n !== residuals.length || n < 3) return null
  const squared = residuals.map((e) => e * e)
  const min = Math.min(...squared)
  const max = Math.max(...squared)
  if (max === min) return null
  const auxiliary = olsFit(fitted, squared, 1)
  if (!auxiliary) return null
  const quality = fitQuality(fitted, squared, auxiliary.coefficients)
  const statistic = Math.max(0, n * quality.r2)
  return { statistic, df: 1, p: chiSquare2UpperP(statistic) }
}

export interface VarianceTestResult {
  /** Brown–Forsythe (median-centred Levene) F statistic. */
  f: number
  df1: number
  df2: number
  p: number
}

/**
 * Brown–Forsythe test for equal group variances: one-way ANOVA over the
 * absolute deviations from each group median. The median centring makes it
 * robust to the non-normality that already fails an ANOVA's residual check,
 * so the two checks do not merely repeat each other.
 */
export function brownForsytheTest(
  groups: Array<{ group: string; values: number[] }>,
): VarianceTestResult | null {
  const used = groups.filter((entry) => entry.values.length > 0)
  if (used.length < 2) return null
  const deviations = used.map((entry) => {
    const median = quantileSorted(sortNumbers(entry.values), 0.5)
    return {
      group: entry.group,
      values: entry.values.map((v) => Math.abs(v - median)),
    }
  })
  const anova = oneWayAnova(deviations)
  if (!anova || !Number.isFinite(anova.f)) return null
  return { f: anova.f, df1: anova.dfBetween, df2: anova.dfWithin, p: anova.p }
}
