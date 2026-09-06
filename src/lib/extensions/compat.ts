/**
 * EXT-03 — Extension version compatibility and distribution trust.
 *
 * Two pure concerns the admin distribution UI and the manifest contract
 * share:
 *
 * 1. Compatibility: a manifest may declare `compatibleWith`, an app-version
 *    range (`*`, or space-separated `>=`/`<=`/`>`/`<`/`=` comparators over
 *    `X.Y.Z[-prerelease]` versions, all ANDed). `checkExtensionCompat`
 *    reports `compatible` / `unknown` / `incompatible` for an install
 *    against the running app version. There are no compatibility shims
 *    (SDK-03 precedent: explicit policy, no silent aliases): an
 *    incompatible install warns loudly and needs explicit admin
 *    acknowledgement, but the server never auto-disables or rewrites it —
 *    the admin stays in control and nothing silently breaks.
 * 2. Trust: only `https:` sources are trusted by default. Every other
 *    source identity (`dev:`, `registry:`, …) is untrusted and requires an
 *    explicit admin acknowledgement at install/update time, enforced both
 *    in this module (UI gating) and in the `api.install_extension` /
 *    `api.update_extension` RPCs (server enforcement). Trust is never
 *    silent and never inferred from a manifest claim.
 *
 * The running app version has no static constant: it comes from the
 * deployment diagnostics (`deployment.artifact.version`, surfaced in the
 * admin Deploy section). Callers pass it in; a missing or unparsable
 * version reports `unknown`, never `compatible`.
 */

export type ExtensionCompatState = 'compatible' | 'unknown' | 'incompatible'

export interface ParsedSemver {
  major: number
  minor: number
  patch: number
  /** Prerelease identifiers, or null for a final release. Build metadata is dropped. */
  prerelease: string[] | null
}

const SEMVER_CORE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Parse a semver string; returns null instead of throwing. */
export function parseSemver(version: unknown): ParsedSemver | null {
  if (typeof version !== 'string') return null
  const match = SEMVER_CORE.exec(version.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : null,
  }
}

function compareIdentifiers(a: string, b: string): number {
  const aNum = /^(0|[1-9]\d*)$/.test(a) ? Number(a) : null
  const bNum = /^(0|[1-9]\d*)$/.test(b) ? Number(b) : null
  if (aNum !== null && bNum !== null) return aNum < bNum ? -1 : aNum > bNum ? 1 : 0
  // Numeric identifiers sort below alphanumeric ones (semver §11.4.4).
  if (aNum !== null) return -1
  if (bNum !== null) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Semver precedence (build metadata ignored). Returns -1/0/1, or NaN when
 * either side is unparsable — callers treat NaN as "no ordering known".
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return NaN
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
  }
  if (pa.prerelease === null && pb.prerelease === null) return 0
  if (pa.prerelease === null) return 1
  if (pb.prerelease === null) return -1
  const length = Math.max(pa.prerelease.length, pb.prerelease.length)
  for (let i = 0; i < length; i++) {
    if (i >= pa.prerelease.length) return -1
    if (i >= pb.prerelease.length) return 1
    const order = compareIdentifiers(pa.prerelease[i], pb.prerelease[i])
    if (order !== 0) return order
  }
  return 0
}

type ComparatorOp = '>=' | '<=' | '>' | '<' | '='

interface CompatComparator {
  op: ComparatorOp | '*'
  version: ParsedSemver
}

const RANGE_TOKEN =
  /^(>=|<=|>|<|=)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/

/**
 * Validate a `compatibleWith` range value, returning every problem found.
 * Never throws. The grammar is deliberately small — `*`, exact versions
 * and explicit comparators only; no caret/tilde/fuzzy shims.
 */
export function validateCompatRange(input: unknown): string[] {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return ['compatibleWith must be a non-empty version range']
  }
  if (input.length > 200) {
    return ['compatibleWith must be at most 200 characters']
  }
  const errors: string[] = []
  const tokens = input.trim().split(/\s+/)
  for (const token of tokens) {
    if (token === '*') continue
    if (!RANGE_TOKEN.test(token)) {
      errors.push(`invalid compatibleWith comparator: ${token}`)
    }
  }
  return errors
}

function parseCompatComparators(range: string): CompatComparator[] | null {
  const out: CompatComparator[] = []
  for (const token of range.trim().split(/\s+/)) {
    if (token === '*') {
      out.push({ op: '*', version: { major: 0, minor: 0, patch: 0, prerelease: null } })
      continue
    }
    const match = RANGE_TOKEN.exec(token)
    if (!match) return null
    out.push({
      op: (match[1] ?? '=') as ComparatorOp,
      version: {
        major: Number(match[2]),
        minor: Number(match[3]),
        patch: Number(match[4]),
        prerelease: match[5] ? match[5].split('.') : null,
      },
    })
  }
  return out
}

function compareParsed(a: ParsedSemver, b: ParsedSemver): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease === null && b.prerelease === null) return 0
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < length; i++) {
    if (i >= a.prerelease.length) return -1
    if (i >= b.prerelease.length) return 1
    const order = compareIdentifiers(a.prerelease[i], b.prerelease[i])
    if (order !== 0) return order
  }
  return 0
}

/**
 * Compatibility of one install against the running app version:
 * - `compatible`: the manifest declares a range and the app satisfies it.
 * - `unknown`: no range declared, or the app version is missing/unparsable
 *   (diagnostics unavailable) — warn, never assume.
 * - `incompatible`: the manifest declares a range and the app violates it —
 *   warn loudly, require explicit acknowledgement, never silently break.
 */
export function checkExtensionCompat(
  manifest: { compatibleWith?: string | null | undefined },
  appVersion: string | null | undefined,
): ExtensionCompatState {
  const range = manifest.compatibleWith?.trim() ?? ''
  if (!range) return 'unknown'
  const app = parseSemver(appVersion)
  if (!app) return 'unknown'
  const comparators = parseCompatComparators(range)
  if (!comparators) return 'unknown'
  for (const comparator of comparators) {
    if (comparator.op === '*') continue
    const order = compareParsed(app, comparator.version)
    const satisfied =
      comparator.op === '='
        ? order === 0
        : comparator.op === '>='
          ? order >= 0
          : comparator.op === '<='
            ? order <= 0
            : comparator.op === '>'
              ? order > 0
              : order < 0
    if (!satisfied) return 'incompatible'
  }
  return 'compatible'
}

/** Human-readable compat state for admin surfaces; never leaks internals. */
export function describeExtensionCompat(state: ExtensionCompatState): string {
  switch (state) {
    case 'compatible':
      return 'Compatible with this app version.'
    case 'incompatible':
      return 'Incompatible with this app version — enabling or updating needs explicit acknowledgement.'
    case 'unknown':
      return 'Compatibility unknown — the manifest declares no range or the app version is unavailable.'
  }
}

/**
 * Whether `knownVersion` is strictly newer than `installedVersion`.
 * Fail-closed display: unparsable input reports no update, never a prompt.
 */
export function isUpdateAvailable(
  installedVersion: string,
  knownVersion: string,
): boolean {
  const order = compareSemver(installedVersion, knownVersion)
  return Number.isNaN(order) ? false : order < 0
}

/**
 * Distribution trust policy (mirrored in the install/update RPCs):
 * `https:` sources are trusted; every other source identity is untrusted
 * and requires explicit admin acknowledgement. Trust is never inferred.
 */
export function isTrustedExtensionSource(source: string): boolean {
  return source.startsWith('https://')
}

/** Whether installing/updating from `source` needs explicit acknowledgement. */
export function requiresTrustAcknowledgement(source: string): boolean {
  return !isTrustedExtensionSource(source.trim())
}
