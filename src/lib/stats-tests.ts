/**
 * Hypothesis tests that sit beside `stats.ts`: Student, Welch and paired
 * t-tests, Mann–Whitney, Tukey and Dunnett comparisons after a one-way
 * ANOVA, multiple-testing corrections, and Kaplan–Meier survival with the
 * log-rank test.
 *
 * Everything here is pure and deterministic. A test that is undefined for the
 * data at hand returns null rather than a made-up number, in the same way as
 * the rest of the analysis kernel.
 */

import {
  logGamma,
  regularizedIncompleteBeta,
  summaryStats,
  tTwoSidedP,
} from './stats'

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

/** Standard normal density. */
export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/**
 * Standard normal CDF to double precision (Hart's rational approximation as
 * published by West, 2005).
 */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  const abs = Math.abs(x)
  let cum: number

  if (abs > 37) {
    cum = 0
  } else {
    const e = Math.exp((-abs * abs) / 2)

    if (abs < 7.07106781186547) {
      let b = 3.52624965998911e-2 * abs + 0.700383064443688
      b = b * abs + 6.37396220353165
      b = b * abs + 33.912866078383
      b = b * abs + 112.079291497871
      b = b * abs + 221.213596169931
      b = b * abs + 220.206867912376
      cum = e * b
      b = 8.83883476483184e-2 * abs + 1.75566716318264
      b = b * abs + 16.064177579207
      b = b * abs + 86.7807322029461
      b = b * abs + 296.564248779674
      b = b * abs + 637.333633378831
      b = b * abs + 793.826512519948
      b = b * abs + 440.413735824752
      cum /= b
    } else {
      let b = abs + 0.65
      b = abs + 4 / b
      b = abs + 3 / b
      b = abs + 2 / b
      b = abs + 1 / b
      cum = e / b / 2.506628274631
    }
  }

  return x > 0 ? 1 - cum : cum
}

/** Two-sided p-value of a standard normal statistic. */
export function normalTwoSidedP(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)))
}

/** CDF of Student's t distribution. */
export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(t) || !(df > 0)) return Number.NaN
  const tail = 0.5 * tTwoSidedP(t, df)

  return t >= 0 ? 1 - tail : tail
}

/** Quantile of Student's t distribution (bisection on the CDF). */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) return Number.NaN

  if (p === 0.5) return 0
  let lo = -1
  let hi = 1

  while (tCdf(lo, df) > p) lo *= 2

  while (tCdf(hi, df) < p) hi *= 2

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2

    if (tCdf(mid, df) < p) lo = mid
    else hi = mid

    if (hi - lo < 1e-12) break
  }

  return (lo + hi) / 2
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (!(a > 0) || !(x >= 0)) return Number.NaN

  if (x === 0) return 0

  if (x < a + 1) {
    let sum = 1 / a
    let term = sum

    for (let n = 1; n < 500; n++) {
      term *= x / (a + n)
      sum += term

      if (Math.abs(term) < Math.abs(sum) * 1e-15) break
    }

    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a))
  }

  // Continued fraction for Q(a, x), modified Lentz.
  const tiny = 1e-300
  let b = x + 1 - a
  let c = 1 / tiny
  let d = 1 / b
  let h = d

  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b

    if (Math.abs(d) < tiny) d = tiny
    c = b + an / c

    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta

    if (Math.abs(delta - 1) < 1e-15) break
  }

  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h
}

/** Upper-tail p-value of a χ² statistic with `df` degrees of freedom. */
export function chiSquareUpperP(x: number, df: number): number {
  if (!Number.isFinite(x) || !(df > 0)) return Number.NaN

  if (x <= 0) return 1

  return Math.max(0, 1 - gammaP(df / 2, x / 2))
}

// ---------------------------------------------------------------------------
// Multiple-testing corrections
// ---------------------------------------------------------------------------

export const P_ADJUSTMENTS = ['none', 'bonferroni', 'holm', 'bh'] as const

export type PAdjustment = (typeof P_ADJUSTMENTS)[number]

/** Adjust a family of p-values. Order of the input is preserved. */
export function adjustPValues(p: number[], method: PAdjustment): number[] {
  const m = p.length

  if (method === 'none' || m === 0) return [...p]

  if (method === 'bonferroni') return p.map((v) => Math.min(1, v * m))
  const order = p.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = Array.from<number>({ length: m })

  if (method === 'holm') {
    let running = 0
    order.forEach((entry, rank) => {
      running = Math.max(running, Math.min(1, entry.v * (m - rank)))
      out[entry.i] = running
    })

    return out
  }

  // Benjamini–Hochberg
  let running = 1

  for (let rank = m - 1; rank >= 0; rank--) {
    const entry = order[rank]
    running = Math.min(running, Math.min(1, (entry.v * m) / (rank + 1)))
    out[entry.i] = running
  }

  return out
}

// ---------------------------------------------------------------------------
// t-tests
// ---------------------------------------------------------------------------

export const T_TEST_KINDS = [
  'welch',
  'student',
  'paired',
  'one_sample',
] as const

export type TTestKind = (typeof T_TEST_KINDS)[number]

export interface TTestResult {
  kind: TTestKind
  n1: number
  n2: number | null
  mean1: number
  mean2: number | null
  /** Mean difference (group 1 − group 2, paired differences, or mean − mu). */
  difference: number
  se: number
  t: number
  df: number
  p: number
  ci95: { lo: number; hi: number }
  /** Cohen's d (pooled SD; SD of differences when paired). */
  effectSize: number | null
}

function finite(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v))
}

function result(
  kind: TTestKind,
  parts: Omit<TTestResult, 'kind' | 'p' | 'ci95' | 't'>,
): TTestResult | null {
  if (!(parts.se > 0) || !(parts.df > 0)) return null
  const t = parts.difference / parts.se
  const crit = tQuantile(0.975, parts.df)

  return {
    kind,
    ...parts,
    t,
    p: tTwoSidedP(t, parts.df),
    ci95: {
      lo: parts.difference - crit * parts.se,
      hi: parts.difference + crit * parts.se,
    },
  }
}

/** One-sample t-test of the mean against `mu`. Null when n < 2 or no spread. */
export function oneSampleTTest(values: number[], mu = 0): TTestResult | null {
  const x = finite(values)
  const s = summaryStats(x)

  if (!s || s.n < 2 || s.sd === null) return null

  return result('one_sample', {
    n1: s.n,
    n2: null,
    mean1: s.mean,
    mean2: null,
    difference: s.mean - mu,
    se: s.sd / Math.sqrt(s.n),
    df: s.n - 1,
    effectSize: s.sd > 0 ? (s.mean - mu) / s.sd : null,
  })
}

/** Welch's unequal-variance two-sample t-test. */
export function welchTTest(a: number[], b: number[]): TTestResult | null {
  const x = finite(a)
  const y = finite(b)
  const sa = summaryStats(x)
  const sb = summaryStats(y)

  if (!sa || !sb || sa.n < 2 || sb.n < 2 || sa.sd === null || sb.sd === null)
    return null
  const va = (sa.sd * sa.sd) / sa.n
  const vb = (sb.sd * sb.sd) / sb.n
  const se = Math.sqrt(va + vb)
  const df = (va + vb) ** 2 / ((va * va) / (sa.n - 1) + (vb * vb) / (sb.n - 1))

  const pooled = Math.sqrt(
    ((sa.n - 1) * sa.sd ** 2 + (sb.n - 1) * sb.sd ** 2) / (sa.n + sb.n - 2),
  )

  return result('welch', {
    n1: sa.n,
    n2: sb.n,
    mean1: sa.mean,
    mean2: sb.mean,
    difference: sa.mean - sb.mean,
    se,
    df,
    effectSize: pooled > 0 ? (sa.mean - sb.mean) / pooled : null,
  })
}

/** Student's equal-variance two-sample t-test. */
export function studentTTest(a: number[], b: number[]): TTestResult | null {
  const x = finite(a)
  const y = finite(b)
  const sa = summaryStats(x)
  const sb = summaryStats(y)

  if (!sa || !sb || sa.n < 2 || sb.n < 2 || sa.sd === null || sb.sd === null)
    return null
  const df = sa.n + sb.n - 2

  const pooled = Math.sqrt(
    ((sa.n - 1) * sa.sd ** 2 + (sb.n - 1) * sb.sd ** 2) / df,
  )

  return result('student', {
    n1: sa.n,
    n2: sb.n,
    mean1: sa.mean,
    mean2: sb.mean,
    difference: sa.mean - sb.mean,
    se: pooled * Math.sqrt(1 / sa.n + 1 / sb.n),
    df,
    effectSize: pooled > 0 ? (sa.mean - sb.mean) / pooled : null,
  })
}

/**
 * Paired t-test. The two arrays are matched by position; pairs where either
 * value is missing are dropped. Returns null if the arrays differ in length.
 */
export function pairedTTest(a: number[], b: number[]): TTestResult | null {
  if (a.length !== b.length) return null
  const diffs: number[] = []
  const left: number[] = []
  const right: number[] = []

  for (let i = 0; i < a.length; i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      diffs.push(a[i] - b[i])
      left.push(a[i])
      right.push(b[i])
    }
  }

  const sd = summaryStats(diffs)

  if (!sd || sd.n < 2 || sd.sd === null) return null

  return result('paired', {
    n1: sd.n,
    n2: sd.n,
    mean1: summaryStats(left)!.mean,
    mean2: summaryStats(right)!.mean,
    difference: sd.mean,
    se: sd.sd / Math.sqrt(sd.n),
    df: sd.n - 1,
    effectSize: sd.sd > 0 ? sd.mean / sd.sd : null,
  })
}

// ---------------------------------------------------------------------------
// Mann–Whitney U
// ---------------------------------------------------------------------------

export interface MannWhitneyResult {
  n1: number
  n2: number
  u1: number
  u2: number
  /** The smaller of u1 and u2. */
  u: number
  p: number
  method: 'exact' | 'normal_approximation'
  median1: number
  median2: number
  /** Rank-biserial correlation, in [−1, 1]. */
  effectSize: number
}

/** Number of ways to get U = u with sizes (n, m): DP table of counts. */
function mannWhitneyCounts(n: number, m: number): number[] {
  // c[i][j] is an array of counts over u for sizes (i, j).
  const table: number[][][] = []

  for (let i = 0; i <= n; i++) {
    table[i] = []

    for (let j = 0; j <= m; j++) {
      if (i === 0 || j === 0) {
        table[i][j] = [1]
        continue
      }

      const size = i * j + 1
      const row = Array.from<number>({ length: size }).fill(0)
      const viaI = table[i - 1][j]
      const viaJ = table[i][j - 1]

      for (let u = 0; u < size; u++) {
        // Largest element is from sample 1: it beats all j of sample 2.
        const a = u - j >= 0 && u - j < viaI.length ? viaI[u - j] : 0
        const b = u < viaJ.length ? viaJ[u] : 0
        row[u] = a + b
      }

      table[i][j] = row
    }
  }

  return table[n][m]
}

/** Two-sided Mann–Whitney U test (exact for small untied samples). */
export function mannWhitneyU(
  a: number[],
  b: number[],
): MannWhitneyResult | null {
  const x = finite(a)
  const y = finite(b)
  const n1 = x.length
  const n2 = y.length

  if (n1 < 1 || n2 < 1) return null

  const all = [
    ...x.map((v) => ({ v, g: 0 })),
    ...y.map((v) => ({ v, g: 1 })),
  ].sort((p, q) => p.v - q.v)

  const ranks = Array.from<number>({ length: all.length })
  let tieTerm = 0
  let hasTies = false

  for (let i = 0; i < all.length;) {
    let j = i

    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++
    const rank = (i + j) / 2 + 1

    for (let k = i; k <= j; k++) ranks[k] = rank
    const t = j - i + 1

    if (t > 1) {
      hasTies = true
      tieTerm += t ** 3 - t
    }

    i = j + 1
  }

  let r1 = 0
  all.forEach((entry, i) => {
    if (entry.g === 0) r1 += ranks[i]
  })
  const u1 = r1 - (n1 * (n1 + 1)) / 2
  const u2 = n1 * n2 - u1
  const u = Math.min(u1, u2)
  const median = (v: number[]) => summaryStats(v)!.median
  let p: number
  let method: MannWhitneyResult['method']

  if (!hasTies && n1 <= 20 && n2 <= 20) {
    const counts = mannWhitneyCounts(n1, n2)
    const total = counts.reduce((s, c) => s + c, 0)
    let tail = 0

    for (let k = 0; k <= Math.floor(u); k++) tail += counts[k] ?? 0
    p = Math.min(1, (2 * tail) / total)
    method = 'exact'
  } else {
    const n = n1 + n2
    const mean = (n1 * n2) / 2
    const variance = ((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1)))

    if (!(variance > 0)) return null
    const z = (Math.abs(u1 - mean) - 0.5) / Math.sqrt(variance)
    p = Math.min(1, normalTwoSidedP(Math.max(0, z)))
    method = 'normal_approximation'
  }

  return {
    n1,
    n2,
    u1,
    u2,
    u,
    p,
    method,
    median1: median(x),
    median2: median(y),
    effectSize: (u1 - u2) / (n1 * n2),
  }
}

// ---------------------------------------------------------------------------
// Simpson integration helper
// ---------------------------------------------------------------------------

function simpson(f: (x: number) => number, a: number, b: number, n: number) {
  const steps = n % 2 === 0 ? n : n + 1
  const h = (b - a) / steps
  let sum = f(a) + f(b)

  for (let i = 1; i < steps; i++) sum += f(a + i * h) * (i % 2 === 0 ? 2 : 4)

  return (sum * h) / 3
}

/** Density of s = χ_ν / √ν. */
function scaledChiDensity(s: number, df: number): number {
  if (!(s > 0)) return 0

  const logDensity =
    Math.log(2) +
    (df / 2) * Math.log(df / 2) -
    logGamma(df / 2) +
    (df - 1) * Math.log(s) -
    (df * s * s) / 2

  return Math.exp(logDensity)
}

/** Integrate `inner(s)` against the density of s = χ_ν / √ν. */
function overScaledChi(inner: (s: number) => number, df: number): number {
  if (df > 2000) return inner(1)
  const spread = 8 / Math.sqrt(2 * df)
  const lo = Math.max(1e-9, 1 - spread)
  const hi = 1 + spread

  return simpson((s) => scaledChiDensity(s, df) * inner(s), lo, hi, 240)
}

// ---------------------------------------------------------------------------
// Studentised range (Tukey)
// ---------------------------------------------------------------------------

function rangeProbability(w: number, k: number): number {
  // P(range of k standard normals < w)
  const f = (z: number) =>
    normalPdf(z) * Math.max(0, normalCdf(z) - normalCdf(z - w)) ** (k - 1)

  return k * simpson(f, -8, 8 + w, 240)
}

/** CDF of the studentised range with k groups and df error degrees of freedom. */
export function studentizedRangeCdf(q: number, k: number, df: number): number {
  if (!(q > 0)) return 0

  if (!(k >= 2) || !(df > 0)) return Number.NaN

  return Math.min(
    1,
    Math.max(
      0,
      overScaledChi((s) => rangeProbability(q * s, k), df),
    ),
  )
}

/** Upper-tail probability of the studentised range (Tukey adjusted p). */
export function studentizedRangeUpperP(q: number, k: number, df: number) {
  return Math.max(0, 1 - studentizedRangeCdf(q, k, df))
}

/** Critical studentised range value (e.g. 0.95 for a 5% familywise level). */
export function studentizedRangeQuantile(
  prob: number,
  k: number,
  df: number,
): number {
  let lo = 0
  let hi = 4

  while (studentizedRangeCdf(hi, k, df) < prob) hi *= 2

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2

    if (studentizedRangeCdf(mid, k, df) < prob) lo = mid
    else hi = mid

    if (hi - lo < 1e-8) break
  }

  return (lo + hi) / 2
}

// ---------------------------------------------------------------------------
// Dunnett many-to-one
// ---------------------------------------------------------------------------

/**
 * P(max |T_i| < d) for Dunnett's many-to-one comparisons against a control,
 * allowing unequal group sizes. The correlation between comparisons has a
 * one-factor form (each shares the control mean), so the multivariate t
 * reduces to a two-dimensional integral over the control's normal deviate and
 * the pooled SD.
 */
export function dunnettCdf(
  d: number,
  groupSizes: number[],
  controlSize: number,
  df: number,
): number {
  if (!(d > 0)) return 0
  const lambdas = groupSizes.map((n) => Math.sqrt(n / (n + controlSize)))

  const inner = (s: number) =>
    simpson(
      (z) => {
        let prod = normalPdf(z)

        for (const lambda of lambdas) {
          const scale = Math.sqrt(1 - lambda * lambda)
          prod *=
            normalCdf((lambda * z + d * s) / scale) -
            normalCdf((lambda * z - d * s) / scale)
        }

        return prod
      },
      -8,
      8,
      200,
    )

  return Math.min(1, Math.max(0, overScaledChi(inner, df)))
}

/** Critical |t| for Dunnett's test at the given familywise coverage. */
export function dunnettCritical(
  prob: number,
  groupSizes: number[],
  controlSize: number,
  df: number,
): number {
  let lo = 0
  let hi = 4

  while (dunnettCdf(hi, groupSizes, controlSize, df) < prob) hi *= 2

  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2

    if (dunnettCdf(mid, groupSizes, controlSize, df) < prob) lo = mid
    else hi = mid

    if (hi - lo < 1e-7) break
  }

  return (lo + hi) / 2
}

// ---------------------------------------------------------------------------
// Post-hoc comparisons after a one-way ANOVA
// ---------------------------------------------------------------------------

export const POST_HOC_METHODS = [
  'tukey',
  'dunnett',
  'bonferroni',
  'holm',
] as const

export type PostHocMethod = (typeof POST_HOC_METHODS)[number]

export interface PostHocComparison {
  group1: string
  group2: string
  /** group1 mean − group2 mean. For Dunnett, group2 is always the control. */
  difference: number
  se: number
  /** t statistic (Tukey reports q = |t|·√2 as well). */
  t: number
  q: number | null
  pAdjusted: number
  ci95: { lo: number; hi: number }
  significant: boolean
}

export interface PostHocResult {
  method: PostHocMethod
  alpha: number
  msWithin: number
  dfWithin: number
  control: string | null
  comparisons: PostHocComparison[]
}

/**
 * Pairwise comparisons using the ANOVA's pooled within-group variance.
 * Tukey–Kramer handles unequal group sizes. Dunnett compares each group with
 * `control` only. Bonferroni and Holm run pooled-variance t-tests over all
 * pairs. Null when the ANOVA itself is undefined or `control` is unknown.
 */
export function postHocComparisons(
  groups: Array<{ group: string; values: number[] }>,
  method: PostHocMethod,
  options: { control?: string; alpha?: number } = {},
): PostHocResult | null {
  const alpha = options.alpha ?? 0.05

  const used = groups.flatMap((g) => {
    const values = finite(g.values)

    return values.length > 0 ? [{ group: g.group, values }] : []
  })

  const k = used.length

  if (k < 2) return null
  const stats = used.map((g) => summaryStats(g.values)!)
  const n = stats.reduce((s, g) => s + g.n, 0)
  const dfWithin = n - k

  if (dfWithin < 1) return null
  let ssWithin = 0

  for (const g of stats) if (g.sd !== null) ssWithin += (g.n - 1) * g.sd ** 2
  const msWithin = ssWithin / dfWithin

  if (!(msWithin > 0)) return null

  const comparisons: PostHocComparison[] = []
  const tCrit = tQuantile(1 - alpha / 2, dfWithin)
  let control: string | null = null

  if (method === 'dunnett') {
    const controlName = options.control ?? used[0].group
    const ci = used.findIndex((g) => g.group === controlName)

    if (ci < 0) return null
    control = controlName
    const others = Array.from(used.keys()).filter((i) => i !== ci)
    const sizes = others.map((i) => stats[i].n)
    const crit = dunnettCritical(1 - alpha, sizes, stats[ci].n, dfWithin)

    for (const i of others) {
      const se = Math.sqrt(msWithin * (1 / stats[i].n + 1 / stats[ci].n))
      const diff = stats[i].mean - stats[ci].mean
      const t = diff / se

      const pAdjusted = Math.max(
        0,
        1 - dunnettCdf(Math.abs(t), sizes, stats[ci].n, dfWithin),
      )

      comparisons.push({
        group1: used[i].group,
        group2: controlName,
        difference: diff,
        se,
        t,
        q: null,
        pAdjusted,
        ci95: { lo: diff - crit * se, hi: diff + crit * se },
        significant: pAdjusted < alpha,
      })
    }

    return { method, alpha, msWithin, dfWithin, control, comparisons }
  }

  const pairs: Array<[number, number]> = []

  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j])

  const raw: Array<{ diff: number; se: number; t: number; q: number }> =
    pairs.map(([i, j]) => {
      const diff = stats[i].mean - stats[j].mean
      const seT = Math.sqrt(msWithin * (1 / stats[i].n + 1 / stats[j].n))
      const t = diff / seT

      return { diff, se: seT, t, q: Math.abs(t) * Math.SQRT2 }
    })

  if (method === 'tukey') {
    const crit = studentizedRangeQuantile(1 - alpha, k, dfWithin)
    pairs.forEach(([i, j], idx) => {
      const r = raw[idx]
      const pAdjusted = studentizedRangeUpperP(r.q, k, dfWithin)
      const half = (crit / Math.SQRT2) * r.se
      comparisons.push({
        group1: used[i].group,
        group2: used[j].group,
        difference: r.diff,
        se: r.se,
        t: r.t,
        q: r.q,
        pAdjusted,
        ci95: { lo: r.diff - half, hi: r.diff + half },
        significant: pAdjusted < alpha,
      })
    })
  } else {
    const rawP = raw.map((r) => tTwoSidedP(r.t, dfWithin))
    const adjusted = adjustPValues(rawP, method)
    pairs.forEach(([i, j], idx) => {
      const r = raw[idx]

      const half =
        method === 'bonferroni'
          ? tQuantile(1 - alpha / (2 * pairs.length), dfWithin) * r.se
          : tCrit * r.se

      comparisons.push({
        group1: used[i].group,
        group2: used[j].group,
        difference: r.diff,
        se: r.se,
        t: r.t,
        q: null,
        pAdjusted: adjusted[idx],
        ci95: { lo: r.diff - half, hi: r.diff + half },
        significant: adjusted[idx] < alpha,
      })
    })
  }

  return { method, alpha, msWithin, dfWithin, control, comparisons }
}

// ---------------------------------------------------------------------------
// Kaplan–Meier survival and the log-rank test
// ---------------------------------------------------------------------------

export interface SurvivalObservation {
  /** Time to event or to censoring; must be ≥ 0. */
  time: number
  /** True when the event happened; false when the subject was censored. */
  event: boolean
  group: string
}

export interface KaplanMeierStep {
  time: number
  atRisk: number
  events: number
  censored: number
  survival: number
  /** Greenwood standard error of the survival estimate. */
  se: number
  /** 95% confidence band (log–log transform), clipped to [0, 1]. */
  lo: number
  hi: number
}

export interface KaplanMeierCurve {
  group: string
  n: number
  events: number
  censored: number
  medianSurvival: number | null
  steps: KaplanMeierStep[]
}

export function kaplanMeier(
  observations: SurvivalObservation[],
  group = 'All',
): KaplanMeierCurve | null {
  const data = observations.filter(
    (o) => Number.isFinite(o.time) && o.time >= 0,
  )

  if (data.length === 0) return null
  const times = [...new Set(data.map((o) => o.time))].sort((a, b) => a - b)
  let atRisk = data.length
  let survival = 1
  let greenwood = 0
  const steps: KaplanMeierStep[] = []
  let events = 0
  let censored = 0
  let median: number | null = null

  for (const time of times) {
    const at = data.filter((o) => o.time === time)
    const d = at.filter((o) => o.event).length
    const c = at.length - d

    if (d > 0) {
      survival *= 1 - d / atRisk

      if (atRisk > d) greenwood += d / (atRisk * (atRisk - d))
      else greenwood = Number.POSITIVE_INFINITY
    }

    const se =
      survival > 0 && Number.isFinite(greenwood)
        ? survival * Math.sqrt(greenwood)
        : 0

    let lo = survival
    let hi = survival

    if (survival > 0 && survival < 1 && Number.isFinite(greenwood)) {
      const seLog = Math.sqrt(greenwood) / Math.abs(Math.log(survival))
      lo = survival ** Math.exp(1.96 * seLog)
      hi = survival ** Math.exp(-1.96 * seLog)
    }

    events += d
    censored += c
    steps.push({
      time,
      atRisk,
      events: d,
      censored: c,
      survival,
      se,
      lo: Math.max(0, lo),
      hi: Math.min(1, hi),
    })

    if (median === null && survival <= 0.5) median = time
    atRisk -= at.length
  }

  return {
    group,
    n: data.length,
    events,
    censored,
    medianSurvival: median,
    steps,
  }
}

export interface LogRankResult {
  groups: string[]
  /** Observed and expected events per group. */
  observed: number[]
  expected: number[]
  chiSquare: number
  df: number
  p: number
  /** Two groups only: hazard ratio of the second group vs the first (O/E method). */
  hazardRatio: { hr: number; lo: number; hi: number } | null
}

function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length
  const a = matrix.map((row, i) => [...row, rhs[i]])

  for (let col = 0; col < n; col++) {
    let pivot = col

    for (let r = col + 1; r < n; r++)
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r

    if (Math.abs(a[pivot][col]) < 1e-12) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]

    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = a[r][col] / a[col][col]

      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c]
    }
  }

  return a.map((row, i) => row[n] / row[i])
}

/** Log-rank test across two or more groups. Null if undefined. */
export function logRankTest(
  observations: SurvivalObservation[],
): LogRankResult | null {
  const data = observations.filter(
    (o) => Number.isFinite(o.time) && o.time >= 0,
  )

  const groups = [...new Set(data.map((o) => o.group))]
  const k = groups.length

  if (k < 2) return null

  const times = [
    ...new Set(data.flatMap((o) => (o.event ? [o.time] : []))),
  ].sort((a, b) => a - b)

  if (times.length === 0) return null
  const observed = Array.from<number>({ length: k }).fill(0)
  const expected = Array.from<number>({ length: k }).fill(0)

  const cov = Array.from({ length: k }, () =>
    Array.from<number>({ length: k }).fill(0),
  )

  for (const time of times) {
    const risk = groups.map(
      (g) => data.filter((o) => o.group === g && o.time >= time).length,
    )

    const dead = groups.map(
      (g) =>
        data.filter((o) => o.group === g && o.time === time && o.event).length,
    )

    const n = risk.reduce((s, v) => s + v, 0)
    const d = dead.reduce((s, v) => s + v, 0)

    if (n < 2) continue

    for (let i = 0; i < k; i++) {
      observed[i] += dead[i]
      expected[i] += (d * risk[i]) / n

      for (let j = 0; j < k; j++) {
        const term =
          (d *
            (risk[i] / n) *
            (i === j ? 1 - risk[i] / n : -risk[j] / n) *
            (n - d)) /
          (n - 1)

        cov[i][j] += term
      }
    }
  }

  const diff = observed.map((o, i) => o - expected[i])
  const reduced = cov.slice(0, k - 1).map((row) => row.slice(0, k - 1))
  const solved = solveLinear(reduced, diff.slice(0, k - 1))

  if (!solved) return null

  const chiSquare = diff
    .slice(0, k - 1)
    .reduce((s, v, i) => s + v * solved[i], 0)

  const df = k - 1
  let hazardRatio: LogRankResult['hazardRatio'] = null

  if (k === 2 && cov[1][1] > 0) {
    const variance = cov[1][1]
    const logHr = (observed[1] - expected[1]) / variance
    const se = 1 / Math.sqrt(variance)
    hazardRatio = {
      hr: Math.exp(logHr),
      lo: Math.exp(logHr - 1.96 * se),
      hi: Math.exp(logHr + 1.96 * se),
    }
  }

  return {
    groups,
    observed,
    expected,
    chiSquare,
    df,
    p: chiSquareUpperP(chiSquare, df),
    hazardRatio,
  }
}

/** Convenience: re-export for callers that only import from this module. */
export { regularizedIncompleteBeta }
