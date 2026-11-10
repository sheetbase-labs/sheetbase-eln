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
import { z } from 'zod'

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
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Package metadata is untrusted; the string schema rejects non-text before pip grammar checks (runtime-config.test.ts).
export function requirementProblem(line: unknown): string | null {
  const parsed = z.string().safeParse(line)

  if (!parsed.success) return 'a package must be written as text'
  const text = parsed.data.trim()

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
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Manifest network entries are untrusted; safeParse rejects non-text before host validation (runtime-config.test.ts).
export function hostProblem(host: unknown): string | null {
  const parsed = z.string().safeParse(host)

  if (!parsed.success) return 'a host must be written as text'
  const name = parsed.data

  if (name.length > 253) return `${name.slice(0, 40)}… is too long`

  if (!HOST.test(name))
    return `${name} is not a host name such as eutils.ncbi.nlm.nih.gov or *.ebi.ac.uk (no https://, no path, no port)`

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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the plugin.json boundary; object, list and entry schemas reject malformed declarations without trusting their types.
  value: unknown,
  where = 'python',
) {
  const errors: string[] = []
  const out: PluginPythonDeclaration = { requirements: [], network: [] }

  if (value === undefined || value === null) return { value: out, errors }

  const declaration = z.object({
    requirements: z.unknown().optional(),
    network: z.unknown().optional(),
  })

  const parsed = declaration.safeParse(value)

  if (!parsed.success)
    return { value: out, errors: [`${where} must be an object`] }
  const record = parsed.data
  const keys = declaration.strict().safeParse(value)

  if (!keys.success)
    for (const issue of keys.error.issues)
      if (issue.code === 'unrecognized_keys')
        for (const key of issue.keys)
          errors.push(`unknown key in ${where}: ${key}`)

  for (const [key, check] of [
    ['requirements', requirementProblem],
    ['network', hostProblem],
  ] as const) {
    const raw = record[key]

    if (raw === undefined) continue
    const list = z.array(z.unknown()).safeParse(raw)

    if (!list.success) {
      errors.push(`${where}.${key} must be a list`)
      continue
    }

    const seen = new Set<string>()

    for (const entry of list.data) {
      const problem = check(entry)

      if (problem) {
        errors.push(`${where}.${key}: ${problem}`)
        continue
      }

      const clean = z.string().parse(entry).trim()
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

export const PLUGIN_LIMIT_KEYS = [
  'timeoutSeconds',
  'memoryMb',
  'cpus',
  'processes',
  'scratchMb',
  'dataMb',
  'rows',
  'callsPerMinute',
] as const satisfies readonly (keyof PluginLimits)[]

/** Settings an administrator changed; anything missing is still the default. */
export type PluginLimitOverrides = Partial<PluginLimits>

/** The limits a plugin runs with: its overrides over the defaults. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stored overrides are untrusted; only schema-validated positive numbers replace defaults, independently per key.
export function resolveLimits(overrides?: unknown): PluginLimits {
  const out: PluginLimits = { ...DEFAULT_PLUGIN_LIMITS }
  const parsed = z.looseObject({}).safeParse(overrides)

  if (!parsed.success) return out
  const record = parsed.data

  for (const key of PLUGIN_LIMIT_KEYS) {
    const value = record[key]

    if (key === 'callsPerMinute') {
      if (value === null) out.callsPerMinute = null
      else {
        const rate = z
          .number()
          .positive()
          .refine(Number.isInteger)
          .safeParse(value)

        if (rate.success) out.callsPerMinute = rate.data
      }
    } else {
      const limit = z.number().positive().safeParse(value)

      if (limit.success) out[key] = limit.data
    }
  }

  return out
}

/**
 * Checks a settings change. Values only have to make sense (a positive number,
 * whole where it counts things); nothing here caps what an administrator may
 * give a plugin.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Settings POST bodies enter here; object and per-limit schemas reject malformed values and preserve the public errors array.
export function validateLimitOverrides(input: unknown) {
  const errors: string[] = []
  const value: PluginLimitOverrides = {}
  const parsed = z.looseObject({}).safeParse(input)

  if (!parsed.success) return { value, errors: ['limits must be an object'] }
  const record = parsed.data
  const knownKeys = new Set<string>(PLUGIN_LIMIT_KEYS)

  for (const key of Object.keys(record))
    if (!knownKeys.has(key)) errors.push(`unknown limit: ${key}`)

  for (const key of PLUGIN_LIMIT_KEYS) {
    if (!(key in record)) continue
    const entry = record[key]

    if (key === 'callsPerMinute' && entry === null) {
      value.callsPerMinute = null
      continue
    }

    const whole = key !== 'cpus'
    const number = z.number().positive()

    const limit = (whole ? number.refine(Number.isInteger) : number).safeParse(
      entry,
    )

    if (!limit.success) {
      errors.push(
        `${key} must be a ${whole ? 'whole number' : 'number'} above zero`,
      )
      continue
    }

    value[key] = limit.data
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
