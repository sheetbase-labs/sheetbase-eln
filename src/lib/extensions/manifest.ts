/**
 * EXT-01 — Extension manifest contract.
 *
 * Data-only declarations in EXT-01: the manifest states the extension's
 * identity (id, name, version, source), the authority it asks for (declared
 * capabilities + credential scopes) and the contribution points it wants
 * (object-actions, panels, commands, event-subscriptions from the EVENT-01
 * catalogue). Registration and enforcement of the points themselves is
 * EXT-02's domain — EXT-01 stores the declarations and validates them
 * fail-closed (unknown points, capabilities, scopes or event names are
 * rejected, never ignored).
 *
 * Validation lives here for callers that can run TypeScript and is mirrored
 * in the `api.install_extension` RPC for direct-SQL writers. The parity
 * tests (`manifest.test.ts` + `tests/db/ext-01-extensions.test.ts`) keep the
 * two implementations in lockstep.
 */
import { CAPABILITIES } from '../capability'
import type { Capability } from '../capability'
import { VALID_SCOPES } from '../api-credential-scopes'
import type { Scope } from '../api-credential-scopes'
import { eventByName, resolveEventAlias } from '../event-catalogue'
import { validateCompatRange } from './compat'
import { DATA_POINT_PARSERS, isDataPoint } from './data-points'
import {
  EXTENSION_RUNNER_POINTS,
  parseAnalysisKinds,
  parseOperations,
} from './points'
import type { ExtensionRunnerContributions } from './points'
import {
  EXTENSION_HOOK_POINTS,
  parseBlocks,
  parseColumns,
  parseFieldTypes,
  parsePanelDetails,
  parseRowActions,
  parseTableCells,
} from './hooks'
import type {
  ExtensionHookContributions,
  ExtensionPanelDeclaration,
} from './hooks'

/** Contribution points an extension may declare. EXT-02 registers them. */
export const EXTENSION_CONTRIBUTION_POINTS = [
  'object-actions',
  'panels',
  'commands',
  'event-subscriptions',
  ...EXTENSION_RUNNER_POINTS,
  ...EXTENSION_HOOK_POINTS,
] as const

export type ExtensionContributionPoint =
  (typeof EXTENSION_CONTRIBUTION_POINTS)[number]

function isContributionPoint(
  value: unknown,
): value is ExtensionContributionPoint {
  return (
    typeof value === 'string' &&
    (EXTENSION_CONTRIBUTION_POINTS as readonly string[]).includes(value)
  )
}

/** Workspace-scoped install key (`api.extensions.key`). */
export const EXTENSION_KEY_PATTERN = /^[a-z][a-z0-9-]{0,48}$/

/** Namespaced package identity, e.g. `acme.retest-tracker`. */
export const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Source identity: an `https:` URL or a namespaced `scheme:id` reference
 * (e.g. `registry:acme/retest-tracker`). EXT-03 tightens which sources a
 * workspace trusts; EXT-01 only pins the identity shape.
 */
const SOURCE_PATTERN = /^[a-z][a-z0-9-]*:[^/][a-zA-Z0-9._/~?#%@!$&'()*+,;=-]+$/

const KNOWN_CAPABILITIES: readonly string[] = CAPABILITIES
const KNOWN_SCOPES: readonly string[] = VALID_SCOPES

export interface ExtensionNamedDeclaration {
  id: string
  title: string
}

export interface ExtensionEventSubscriptionDeclaration {
  /** Canonical EVENT-01 catalogue name (aliases normalized on validate). */
  eventType: string
}

export interface ExtensionContributions
  extends ExtensionRunnerContributions, ExtensionHookContributions {
  'object-actions'?: ExtensionNamedDeclaration[]
  panels?: ExtensionPanelDeclaration[]
  commands?: ExtensionNamedDeclaration[]
  'event-subscriptions'?: ExtensionEventSubscriptionDeclaration[]
}

export interface ExtensionManifest {
  id: string
  name: string
  version: string
  source: string
  /**
   * Optional app-version range this manifest supports (`*`, or
   * space-separated `>=`/`<=`/`>`/`<`/`=` comparators, all ANDed).
   * Absent means compatibility is unknown, never assumed. Grammar and
   * evaluation live in `./compat` (EXT-03); this contract only pins the
   * shape so TS and SQL validation stay in lockstep.
   */
  compatibleWith?: string
  /** What the plugin is for, in a sentence, for the administrator's list. */
  description?: string
  author?: string
  capabilities: Capability[]
  scopes: Scope[]
  contributions: ExtensionContributions
}

export class ExtensionManifestError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(`Invalid extension manifest: ${errors.join('; ')}`)
    this.name = 'ExtensionManifestError'
    this.errors = errors
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkKey(value: unknown, errors: string[]): string | null {
  if (typeof value !== 'string' || !EXTENSION_KEY_PATTERN.test(value)) {
    errors.push(
      'key must match ^[a-z][a-z0-9-]{0,48}$ (lowercase, leading letter)',
    )
    return null
  }
  return value
}

function checkName(value: unknown, errors: string[]): string | null {
  if (
    typeof value !== 'string' ||
    value.trim().length < 1 ||
    value.trim().length > 200
  ) {
    errors.push('name must be 1-200 non-blank characters')
    return null
  }
  return value.trim()
}

function checkManifestId(value: unknown, errors: string[]): string | null {
  if (typeof value !== 'string' || !EXTENSION_ID_PATTERN.test(value)) {
    errors.push(
      'id must be a namespaced package identity (e.g. acme.retest-tracker)',
    )
    return null
  }
  return value
}

function checkVersion(value: unknown, errors: string[]): string | null {
  if (typeof value !== 'string' || !SEMVER_PATTERN.test(value)) {
    errors.push('version must be semver (e.g. 1.2.3)')
    return null
  }
  return value
}

function checkSource(value: unknown, errors: string[]): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) {
    errors.push('source must be 1-500 characters')
    return null
  }
  if (value.startsWith('https://')) return value
  if (SOURCE_PATTERN.test(value)) return value
  errors.push(
    'source must be an https: URL or a namespaced scheme:id reference',
  )
  return null
}
function checkCompatibleWith(value: unknown, errors: string[]): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string') {
    errors.push('compatibleWith must be a version range string')
    return null
  }
  const before = errors.length
  const trimmed = value.trim()
  for (const problem of validateCompatRange(trimmed)) {
    errors.push(problem)
  }
  return errors.length > before ? null : trimmed
}

function checkCapabilities(
  value: unknown,
  errors: string[],
): Capability[] | null {
  if (!Array.isArray(value)) {
    errors.push('capabilities must be an array')
    return null
  }
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !KNOWN_CAPABILITIES.includes(entry)) {
      errors.push(`unknown capability: ${String(entry)}`)
      return null
    }
    seen.add(entry)
  }
  return [...seen] as Capability[]
}

function checkScopes(value: unknown, errors: string[]): Scope[] | null {
  if (!Array.isArray(value)) {
    errors.push('scopes must be an array')
    return null
  }
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !KNOWN_SCOPES.includes(entry)) {
      errors.push(`unknown scope: ${String(entry)}`)
      return null
    }
    seen.add(entry)
  }
  return [...seen] as Scope[]
}

function checkNamedList(
  point: string,
  value: unknown,
  errors: string[],
): ExtensionNamedDeclaration[] | null {
  if (!Array.isArray(value)) {
    errors.push(`contributions.${point} must be an array`)
    return null
  }
  const seen = new Set<string>()
  const out: ExtensionNamedDeclaration[] = []
  for (const entry of value) {
    if (!isRecord(entry)) {
      errors.push(`contributions.${point} entries must be objects`)
      return null
    }
    if (typeof entry.id !== 'string' || !EXTENSION_KEY_PATTERN.test(entry.id)) {
      errors.push(
        `contributions.${point} entry ids must match ^[a-z][a-z0-9-]{0,48}$`,
      )
      return null
    }
    if (
      typeof entry.title !== 'string' ||
      entry.title.trim().length < 1 ||
      entry.title.trim().length > 120
    ) {
      errors.push(
        `contributions.${point} entry titles must be 1-120 characters`,
      )
      return null
    }
    if (seen.has(entry.id)) {
      errors.push(`contributions.${point} has a duplicate id: ${entry.id}`)
      return null
    }
    seen.add(entry.id)
    // Extra fields are EXT-02's domain; declarations stay forward-compatible.
    out.push({ id: entry.id, title: entry.title.trim() })
  }
  return out
}

/** Panels are named entries that may also carry a screen or a UI bundle and the models they show on. */
function checkPanels(
  value: unknown,
  errors: string[],
): ExtensionPanelDeclaration[] | null {
  const named = checkNamedList('panels', value, errors)
  if (!named) return null
  const out: ExtensionPanelDeclaration[] = []
  for (const [index, entry] of (
    value as Array<Record<string, unknown>>
  ).entries()) {
    const details = parsePanelDetails(
      entry,
      `contributions.panels.${named[index].id}`,
      errors,
    )
    if (!details) return null
    out.push({ ...named[index], ...details } as ExtensionPanelDeclaration)
  }
  return out
}

function checkEventSubscriptions(
  value: unknown,
  errors: string[],
): ExtensionEventSubscriptionDeclaration[] | null {
  if (!Array.isArray(value)) {
    errors.push('contributions.event-subscriptions must be an array')
    return null
  }
  const seen = new Set<string>()
  const out: ExtensionEventSubscriptionDeclaration[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.eventType !== 'string') {
      errors.push('contributions.event-subscriptions entries need an eventType')
      return null
    }
    // Wire aliases resolve to the canonical catalogue name; unknown names
    // fail closed here rather than at match time.
    const canonical = resolveEventAlias(entry.eventType)
    if (!eventByName(canonical)) {
      errors.push(`unknown event subscription: ${entry.eventType}`)
      return null
    }
    if (seen.has(canonical)) {
      errors.push(`duplicate event subscription: ${canonical}`)
      return null
    }
    seen.add(canonical)
    out.push({ eventType: canonical })
  }
  return out
}

/**
 * Validate a manifest value, returning every problem found. Never throws;
 * unknown contribution points, capabilities, scopes and event names are
 * reported, never silently dropped.
 */
export function validateExtensionManifest(input: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(input)) return ['manifest must be an object']
  checkManifestId(input.id, errors)
  checkName(input.name, errors)
  checkVersion(input.version, errors)
  checkSource(input.source, errors)
  checkCompatibleWith(input.compatibleWith, errors)
  if (
    input.description !== undefined &&
    (typeof input.description !== 'string' ||
      input.description.trim().length < 1 ||
      input.description.trim().length > 600)
  )
    errors.push('description must be 1-600 characters')
  if (
    input.author !== undefined &&
    (typeof input.author !== 'string' ||
      input.author.trim().length < 1 ||
      input.author.trim().length > 200)
  )
    errors.push('author must be 1-200 characters')
  const capabilities = checkCapabilities(input.capabilities, errors)
  const scopes = checkScopes(input.scopes, errors)
  if (
    capabilities !== null &&
    scopes !== null &&
    capabilities.length === 0 &&
    scopes.length === 0
  ) {
    errors.push('manifest must declare at least one capability or scope')
  }
  if (input.contributions === undefined) {
    errors.push('manifest must declare a contributions object (possibly empty)')
  } else if (!isRecord(input.contributions)) {
    errors.push('contributions must be an object')
  } else {
    for (const point of Object.keys(input.contributions)) {
      // Fail closed: a typo must never silently disable a declaration.
      if (!isContributionPoint(point)) {
        errors.push(`unknown contribution point: ${point}`)
      }
    }
    if (input.contributions['object-actions'] !== undefined) {
      checkNamedList(
        'object-actions',
        input.contributions['object-actions'],
        errors,
      )
    }
    if (input.contributions.panels !== undefined) {
      checkPanels(input.contributions.panels, errors)
    }
    if (input.contributions.commands !== undefined) {
      checkNamedList('commands', input.contributions.commands, errors)
    }
    if (input.contributions['event-subscriptions'] !== undefined) {
      checkEventSubscriptions(
        input.contributions['event-subscriptions'],
        errors,
      )
    }
    if (input.contributions.operations !== undefined) {
      parseOperations(input.contributions.operations, errors)
    }
    if (input.contributions['analysis-kinds'] !== undefined) {
      parseAnalysisKinds(input.contributions['analysis-kinds'], errors)
    }
    if (input.contributions.blocks !== undefined) {
      parseBlocks(input.contributions.blocks, errors)
    }
    if (input.contributions['table-cells'] !== undefined) {
      parseTableCells(input.contributions['table-cells'], errors)
    }
    if (input.contributions.columns !== undefined) {
      parseColumns(input.contributions.columns, errors)
    }
    if (input.contributions['row-actions'] !== undefined) {
      parseRowActions(input.contributions['row-actions'], errors)
    }
    if (input.contributions['field-types'] !== undefined) {
      parseFieldTypes(input.contributions['field-types'], errors)
    }
    for (const point of Object.keys(input.contributions)) {
      if (isDataPoint(point))
        DATA_POINT_PARSERS[point](input.contributions[point], errors)
    }
    // Operations, calculators and pipeline steps share one name: plugin.<key>.<id>.
    const called = new Set<string>()
    for (const point of ['operations', 'calculators', 'pipeline-steps']) {
      const entries = input.contributions[point]
      if (!Array.isArray(entries)) continue
      for (const entry of entries as unknown[]) {
        const id = isRecord(entry) ? entry.id : undefined
        if (typeof id !== 'string') continue
        if (called.has(id))
          errors.push(
            `${id} is used twice across operations, calculators and pipeline steps`,
          )
        called.add(id)
      }
    }
  }
  return errors
}

/**
 * Validate and normalize a manifest: trims strings, dedupes authority,
 * resolves event aliases to canonical catalogue names. Throws
 * ExtensionManifestError listing every problem.
 */
export function parseExtensionManifest(input: unknown): ExtensionManifest {
  const errors = validateExtensionManifest(input)
  if (errors.length > 0) throw new ExtensionManifestError(errors)
  const raw = input as Record<string, unknown>
  const contributions: ExtensionContributions = {}
  const declared = raw.contributions as Record<string, unknown>
  if (declared['object-actions'] !== undefined) {
    contributions['object-actions'] = checkNamedList(
      'object-actions',
      declared['object-actions'],
      [],
    )!
  }
  if (declared.panels !== undefined) {
    contributions.panels = checkPanels(declared.panels, [])!
  }
  if (declared.commands !== undefined) {
    contributions.commands = checkNamedList('commands', declared.commands, [])!
  }
  if (declared['event-subscriptions'] !== undefined) {
    contributions['event-subscriptions'] = checkEventSubscriptions(
      declared['event-subscriptions'],
      [],
    )!
  }
  if (declared.operations !== undefined) {
    contributions.operations = parseOperations(declared.operations, [])!
  }
  if (declared['analysis-kinds'] !== undefined) {
    contributions['analysis-kinds'] = parseAnalysisKinds(
      declared['analysis-kinds'],
      [],
    )!
  }
  if (declared.blocks !== undefined) {
    contributions.blocks = parseBlocks(declared.blocks, [])!
  }
  if (declared['table-cells'] !== undefined) {
    contributions['table-cells'] = parseTableCells(declared['table-cells'], [])!
  }
  if (declared.columns !== undefined) {
    contributions.columns = parseColumns(declared.columns, [])!
  }
  if (declared['row-actions'] !== undefined) {
    contributions['row-actions'] = parseRowActions(declared['row-actions'], [])!
  }
  if (declared['field-types'] !== undefined) {
    contributions['field-types'] = parseFieldTypes(declared['field-types'], [])!
  }
  for (const point of Object.keys(declared)) {
    if (isDataPoint(point))
      (contributions as Record<string, unknown>)[point] = DATA_POINT_PARSERS[
        point
      ](declared[point], [])!
  }
  return {
    id: raw.id as string,
    name: (raw.name as string).trim(),
    version: raw.version as string,
    source: raw.source as string,
    ...(typeof raw.compatibleWith === 'string'
      ? { compatibleWith: raw.compatibleWith.trim() }
      : {}),
    ...(typeof raw.description === 'string'
      ? { description: raw.description.trim() }
      : {}),
    ...(typeof raw.author === 'string' ? { author: raw.author.trim() } : {}),
    capabilities: [...new Set(raw.capabilities as Capability[])],
    scopes: [...new Set(raw.scopes as Scope[])],
    contributions,
  }
}

/** Validate a workspace-scoped install key; throws ExtensionManifestError. */
export function assertValidExtensionKey(key: unknown): string {
  const errors: string[] = []
  const ok = checkKey(key, errors)
  if (ok === null) throw new ExtensionManifestError(errors)
  return ok
}
