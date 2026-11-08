/**
 * What a plugin's Python needs to run, and how much room it gets.
 *
 * Two things live here, both pure so the upload form, the settings page, the
 * server and the tests agree:
 *
 * - the packages a plugin installs (`python.requirements` in `plugin.json`) and
 *   the network hosts it asks to reach (`python.network`), and how each is
 *   checked;
 * - the run limits, which are per-plugin settings an administrator can change,
 *   with defaults generous enough that an ordinary scientific plugin never
 *   meets them. Nothing here is a fixed cap on what a plugin can do.
 *
 * Browser safe: no server imports.
 */

// ---------------------------------------------------------------------------
// Packages and network hosts a plugin declares.
// ---------------------------------------------------------------------------

export interface PluginPythonDeclaration {
  /** pip requirement lines, for example `rdkit>=2024.3` or `biopython==1.84`. */
  requirements: string[]
  /** Host names the plugin's code may reach, for example `eutils.ncbi.nlm.nih.gov` or `*.ebi.ac.uk`. */
  network: string[]
}

const NAME = '[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?'
const EXTRAS = '(?:\\[[A-Za-z0-9](?:[A-Za-z0-9._,\\s-]*[A-Za-z0-9])?\\])?'
const VERSION_CLAUSE =
  '(?:===|==|~=|!=|<=|>=|<|>)\\s*[A-Za-z0-9][A-Za-z0-9.*+!_-]*'
const VERSIONS = `(?:\\s*${VERSION_CLAUSE}(?:\\s*,\\s*${VERSION_CLAUSE})*)?`
const MARKER = '(?:\\s*;\\s*[A-Za-z0-9 _.\'"()<>=!~,-]+)?'
/** `name[extras] spec` (optionally with an environment marker), or `name @ https://…`. */
const REQUIREMENT = new RegExp(
  `^${NAME}${EXTRAS}(?:${VERSIONS}|\\s*@\\s*https://[^\\s;]+)${MARKER}$`,
)

/** Why a requirement line is refused, or null when pip can be given it as it is. */
export function requirementProblem(line: unknown): string | null {
  if (typeof line !== 'string') return 'a package must be written as text'
  const text = line.trim()
  if (text.length === 0) return 'a package line is empty'
  if (text.length > 300) return `${text.slice(0, 40)}… is too long`
  if (text.startsWith('-'))
    return `${text} is a pip option, not a package: write the package name and version`
  if (!REQUIREMENT.test(text))
    return `${text} is not a package pip understands (for example rdkit>=2024.3 or biopython==1.84)`
  return null
}

const HOST =
  /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/** Why a network host is refused, or null. A leading `*.` allows every sub-domain. */
export function hostProblem(host: unknown): string | null {
  if (typeof host !== 'string') return 'a host must be written as text'
  if (host.length > 253) return `${host.slice(0, 40)}… is too long`
  if (!HOST.test(host))
    return `${host} is not a host name such as eutils.ncbi.nlm.nih.gov or *.ebi.ac.uk (no https://, no path, no port)`
  return null
}

/** Whether `host` is allowed by a declared list (exact name, or `*.` for sub-domains). */
export function hostAllowed(allowed: readonly string[], host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '')
  return allowed.some((entry) =>
    entry.startsWith('*.')
      ? name.endsWith(entry.slice(1)) && name.length > entry.length - 1
      : name === entry,
  )
}

/** Validates `python` in `plugin.json`; the cleaned declaration, or the problems found. */
export function parsePythonDeclaration(
  value: unknown,
  where = 'python',
): { value: PluginPythonDeclaration; errors: string[] } {
  const errors: string[] = []
  const out: PluginPythonDeclaration = { requirements: [], network: [] }
  if (value === undefined || value === null) return { value: out, errors }
  if (typeof value !== 'object' || Array.isArray(value))
    return { value: out, errors: [`${where} must be an object`] }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record))
    if (key !== 'requirements' && key !== 'network')
      errors.push(`unknown key in ${where}: ${key}`)
  for (const [key, check] of [
    ['requirements', requirementProblem],
    ['network', hostProblem],
  ] as const) {
    const list = record[key]
    if (list === undefined) continue
    if (!Array.isArray(list)) {
      errors.push(`${where}.${key} must be a list`)
      continue
    }
    const seen = new Set<string>()
    for (const entry of list) {
      const problem = check(entry)
      if (problem) {
        errors.push(`${where}.${key}: ${problem}`)
        continue
      }
      const clean = (entry as string).trim()
      const identity = key === 'network' ? clean.toLowerCase() : clean
      if (seen.has(identity)) continue
      seen.add(identity)
      out[key].push(identity)
    }
  }
  return { value: out, errors }
}

// ---------------------------------------------------------------------------
// Limits.
// ---------------------------------------------------------------------------

/**
 * What one plugin call may use. An administrator can change each value per
 * plugin in Settings → Plugins. These are the defaults a plugin gets until
 * they do.
 */
export interface PluginLimits {
  /** How long one call may run, in seconds. */
  timeoutSeconds: number
  /** Memory for one call, in megabytes. */
  memoryMb: number
  /** Processor cores for one call (fractions allowed). */
  cpus: number
  /** Processes and threads one call may start. */
  processes: number
  /** Scratch disk for one call, in megabytes. */
  scratchMb: number
  /** Data sent to the plugin in one call, and the answer back, each in megabytes. */
  dataMb: number
  /** Rows one call may carry in or out. */
  rows: number
  /** Calls per person per minute across the plugin's routes; `null` means no limit. */
  callsPerMinute: number | null
}

export const DEFAULT_PLUGIN_LIMITS: Readonly<PluginLimits> = Object.freeze({
  timeoutSeconds: 600,
  memoryMb: 4096,
  cpus: 2,
  processes: 512,
  scratchMb: 2048,
  dataMb: 256,
  rows: 5_000_000,
  callsPerMinute: null,
})

export const PLUGIN_LIMIT_KEYS = Object.keys(DEFAULT_PLUGIN_LIMITS) as Array<
  keyof PluginLimits
>

/** Settings an administrator changed; anything missing is still the default. */
export type PluginLimitOverrides = Partial<PluginLimits>

/** The limits a plugin runs with: its overrides over the defaults. */
export function resolveLimits(overrides?: unknown): PluginLimits {
  const out: PluginLimits = { ...DEFAULT_PLUGIN_LIMITS }
  if (overrides === null || typeof overrides !== 'object') return out
  const record = overrides as Record<string, unknown>
  for (const key of PLUGIN_LIMIT_KEYS) {
    const value = record[key]
    if (key === 'callsPerMinute') {
      if (value === null) out.callsPerMinute = null
      else if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value > 0
      )
        out.callsPerMinute = value
    } else if (typeof value === 'number' && Number.isFinite(value) && value > 0)
      (out as unknown as Record<string, number>)[key] = value
  }
  return out
}

/**
 * Checks a settings change. Values only have to make sense (a positive number,
 * whole where it counts things); nothing here caps what an administrator may
 * give a plugin.
 */
export function validateLimitOverrides(input: unknown): {
  value: PluginLimitOverrides
  errors: string[]
} {
  const errors: string[] = []
  const value: PluginLimitOverrides = {}
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return { value, errors: ['limits must be an object'] }
  const record = input as Record<string, unknown>
  for (const key of Object.keys(record))
    if (!(PLUGIN_LIMIT_KEYS as string[]).includes(key))
      errors.push(`unknown limit: ${key}`)
  for (const key of PLUGIN_LIMIT_KEYS) {
    if (!(key in record)) continue
    const entry = record[key]
    if (key === 'callsPerMinute' && entry === null) {
      value.callsPerMinute = null
      continue
    }
    const whole = key !== 'cpus'
    if (
      typeof entry !== 'number' ||
      !Number.isFinite(entry) ||
      entry <= 0 ||
      (whole && !Number.isInteger(entry))
    ) {
      errors.push(
        `${key} must be a ${whole ? 'whole number' : 'number'} above zero`,
      )
      continue
    }
    ;(value as Record<string, number>)[key] = entry
  }
  return { value, errors }
}

/** The part of the limits the Python runner needs, in its own units. */
export interface RunnerLimits {
  timeoutSeconds: number
  memoryMb: number
  cpus: number
  processes: number
  scratchMb: number
  /** Bytes each way. */
  bytes: number
  rows: number
}

export function runnerLimits(limits: PluginLimits): RunnerLimits {
  return {
    timeoutSeconds: limits.timeoutSeconds,
    memoryMb: limits.memoryMb,
    cpus: limits.cpus,
    processes: limits.processes,
    scratchMb: limits.scratchMb,
    bytes: Math.round(limits.dataMb * 1024 * 1024),
    rows: limits.rows,
  }
}

// ---------------------------------------------------------------------------
// What the server tells the settings page.
// ---------------------------------------------------------------------------

export type PluginEnvironmentState =
  'none' | 'building' | 'ready' | 'failed' | 'unavailable'

export interface PluginRuntimeInfo {
  extensionId: string
  requirements: string[]
  /** The hosts the administrator approved when adding this version. */
  network: string[]
  /** Only what has been changed from the defaults. */
  overrides: PluginLimitOverrides
  /** What the plugin actually runs with. */
  limits: PluginLimits
  environment: {
    state: PluginEnvironmentState
    /** Why it failed, in the installer's own words. */
    error: string | null
    /** Package name to installed version, once ready. */
    packages: Record<string, string> | null
  }
}
