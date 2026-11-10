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
import { z } from 'zod'

import { CAPABILITIES } from '../capability'
import type { Capability } from '../capability'
import { VALID_SCOPES } from '../api-credential-scopes'
import type { Scope } from '../api-credential-scopes'
import { eventByName, resolveEventAlias } from '../event-catalogue'
import { validateCompatRange } from './compat'
import { DATA_POINT_PARSERS, isDataPoint } from './data-points'
import { parsePythonDeclaration } from './runtime-config'
import type { PluginPythonDeclaration } from './runtime-config'
import {
  EXTENSION_RUNNER_POINTS,
  isRecord,
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
import { EXTENSION_UI_POINTS, parseUiPoint } from './ui-points'
import type { ExtensionUiContributions } from './ui-points'

/** Contribution points an extension may declare. EXT-02 registers them. */
export const EXTENSION_CONTRIBUTION_POINTS = [
  'object-actions',
  'panels',
  'commands',
  'event-subscriptions',
  ...EXTENSION_RUNNER_POINTS,
  ...EXTENSION_HOOK_POINTS,
  ...EXTENSION_UI_POINTS,
] as const

export type ExtensionContributionPoint =
  (typeof EXTENSION_CONTRIBUTION_POINTS)[number]

function isContributionPoint(
  value: unknown,
): value is ExtensionContributionPoint {
  return z.enum(EXTENSION_CONTRIBUTION_POINTS).safeParse(value).success
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

export interface ExtensionNamedDeclaration {
  id: string
  title: string
}

export interface ExtensionEventSubscriptionDeclaration {
  /** Canonical EVENT-01 catalogue name (aliases normalized on validate). */
  eventType: string
}

export interface ExtensionContributions
  extends
    ExtensionRunnerContributions,
    ExtensionHookContributions,
    ExtensionUiContributions {
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
  /**
   * The Python packages the plugin installs and the hosts it may reach, as
   * approved by the administrator who added it. Absent when it needs neither.
   */
  python?: PluginPythonDeclaration
}

export class ExtensionManifestError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(`Invalid extension manifest: ${errors.join('; ')}`)
    this.name = 'ExtensionManifestError'
    this.errors = errors
  }
}

function checkKey(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Workspace install keys enter here; the key schema rejects non-strings and invalid grammar before returning a key.
  value: unknown,
  errors: string[],
): string | null {
  const parsed = z.string().regex(EXTENSION_KEY_PATTERN).safeParse(value)

  if (!parsed.success) {
    errors.push(
      'key must match ^[a-z][a-z0-9-]{0,48}$ (lowercase, leading letter)',
    )

    return null
  }

  return parsed.data
}

function checkName(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This manifest-name boundary parses trimmed non-blank text with its 200-character bound.
  value: unknown,
  errors: string[],
): string | null {
  const parsed = z.string().trim().min(1).max(200).safeParse(value)

  if (!parsed.success) {
    errors.push('name must be 1-200 non-blank characters')

    return null
  }

  return parsed.data
}

function checkManifestId(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Package identity enters from the manifest and is checked against the namespaced grammar here.
  value: unknown,
  errors: string[],
): string | null {
  const parsed = z.string().regex(EXTENSION_ID_PATTERN).safeParse(value)

  if (!parsed.success) {
    errors.push(
      'id must be a namespaced package identity (e.g. acme.retest-tracker)',
    )

    return null
  }

  return parsed.data
}

function checkVersion(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw manifest versions are parsed with the existing semver grammar before becoming strings.
  value: unknown,
  errors: string[],
): string | null {
  const parsed = z.string().regex(SEMVER_PATTERN).safeParse(value)

  if (!parsed.success) {
    errors.push('version must be semver (e.g. 1.2.3)')

    return null
  }

  return parsed.data
}

function checkSource(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The source boundary checks representation and length before the existing https/namespaced-source policy.
  value: unknown,
  errors: string[],
): string | null {
  const parsed = z.string().min(1).max(500).safeParse(value)

  if (!parsed.success) {
    errors.push('source must be 1-500 characters')

    return null
  }

  if (parsed.data.startsWith('https://')) return parsed.data

  if (SOURCE_PATTERN.test(parsed.data)) return parsed.data
  errors.push(
    'source must be an https: URL or a namespaced scheme:id reference',
  )

  return null
}

function checkCompatibleWith(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Optional compatibility declarations must parse as text before the version-range owner checks their grammar.
  value: unknown,
  errors: string[],
): string | null {
  if (value === undefined) return null

  const parsed = z.string().safeParse(value)

  if (!parsed.success) {
    errors.push('compatibleWith must be a version range string')

    return null
  }

  const before = errors.length
  const trimmed = parsed.data.trim()

  for (const problem of validateCompatRange(trimmed)) {
    errors.push(problem)
  }

  return errors.length > before ? null : trimmed
}

function checkCapabilities(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Manifest authority crosses here: parse the list and each capability enum, rejecting before any value enters the typed authority set.
  value: unknown,
  errors: string[],
): Capability[] | null {
  const parsed = z.array(z.unknown()).safeParse(value)

  if (!parsed.success) {
    errors.push('capabilities must be an array')

    return null
  }

  const seen = new Set<Capability>()

  for (const entry of parsed.data) {
    const capability = z.enum(CAPABILITIES).safeParse(entry)

    if (!capability.success) {
      // Invalid authority is echoed with the legacy String coercion, never authorized. manifest.test.ts fixes the diagnostic for object-valued authority.
      errors.push(`unknown capability: ${String(entry)}`)

      return null
    }

    seen.add(capability.data)
  }

  return [...seen]
}

function checkScopes(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Scope declarations are untrusted manifest values; list and vocabulary schemas reject them before constructing typed scope authority.
  value: unknown,
  errors: string[],
): Scope[] | null {
  const parsed = z.array(z.unknown()).safeParse(value)

  if (!parsed.success) {
    errors.push('scopes must be an array')

    return null
  }

  const seen = new Set<Scope>()

  for (const entry of parsed.data) {
    const scope = z.enum(VALID_SCOPES).safeParse(entry)

    if (!scope.success) {
      // Preserve the existing malformed-scope diagnostic, including object coercion; schema rejection above prevents this text from granting authority (manifest.test.ts).
      errors.push(`unknown scope: ${String(entry)}`)

      return null
    }

    seen.add(scope.data)
  }

  return [...seen]
}

function checkNamedList(
  point: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Named contributions enter here: list, object, id and title are checked in their established error order before constructing declarations.
  value: unknown,
  errors: string[],
): ExtensionNamedDeclaration[] | null {
  const parsed = z.array(z.unknown()).safeParse(value)

  if (!parsed.success) {
    errors.push(`contributions.${point} must be an array`)

    return null
  }

  const seen = new Set<string>()
  const out: ExtensionNamedDeclaration[] = []

  for (const entry of parsed.data) {
    if (!isRecord(entry)) {
      errors.push(`contributions.${point} entries must be objects`)

      return null
    }

    const id = z.string().regex(EXTENSION_KEY_PATTERN).safeParse(entry.id)

    if (!id.success) {
      errors.push(
        `contributions.${point} entry ids must match ^[a-z][a-z0-9-]{0,48}$`,
      )

      return null
    }

    const title = z.string().trim().min(1).max(120).safeParse(entry.title)

    if (!title.success) {
      errors.push(
        `contributions.${point} entry titles must be 1-120 characters`,
      )

      return null
    }

    if (seen.has(id.data)) {
      errors.push(`contributions.${point} has a duplicate id: ${id.data}`)

      return null
    }

    seen.add(id.data)
    // Extra fields are EXT-02's domain; declarations stay forward-compatible.
    out.push({ id: id.data, title: title.data })
  }

  return out
}

/** Panels are named entries that may also carry a screen or a UI bundle and the models they show on. */
function checkPanels(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Panels first pass the complete named-list boundary, then their original entries are parsed for screen/UI/model settings without assertions.
  value: unknown,
  errors: string[],
): ExtensionPanelDeclaration[] | null {
  const named = checkNamedList('panels', value, errors)

  if (!named) return null
  const out: ExtensionPanelDeclaration[] = []

  for (const [index, entry] of z.array(z.unknown()).parse(value).entries()) {
    const details = parsePanelDetails(
      entry,
      `contributions.panels.${named[index].id}`,
      errors,
    )

    if (!details) return null
    out.push({ ...named[index], ...details })
  }

  return out
}

function checkEventSubscriptions(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Event-subscription lists and eventType text are parsed here before the event catalogue resolves aliases and checks authority.
  value: unknown,
  errors: string[],
): ExtensionEventSubscriptionDeclaration[] | null {
  const parsed = z.array(z.unknown()).safeParse(value)

  if (!parsed.success) {
    errors.push('contributions.event-subscriptions must be an array')

    return null
  }

  const seen = new Set<string>()
  const out: ExtensionEventSubscriptionDeclaration[] = []

  for (const entry of parsed.data) {
    const event = z.object({ eventType: z.string() }).safeParse(entry)

    if (!event.success) {
      errors.push('contributions.event-subscriptions entries need an eventType')

      return null
    }

    // Wire aliases resolve to the canonical catalogue name; unknown names
    // fail closed here rather than at match time.
    const canonical = resolveEventAlias(event.data.eventType)

    if (!eventByName(canonical)) {
      errors.push(`unknown event subscription: ${event.data.eventType}`)

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

function readExtensionManifest(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- External package manifests enter here; each field is parsed by its declaration owner before a typed manifest is constructed, while original keys remain available for fail-closed checks.
  input: unknown,
) {
  const errors: string[] = []

  if (!isRecord(input))
    return { value: null, errors: ['manifest must be an object'] }
  const id = checkManifestId(input.id, errors)
  const name = checkName(input.name, errors)
  const version = checkVersion(input.version, errors)
  const source = checkSource(input.source, errors)
  const compatibleWith = checkCompatibleWith(input.compatibleWith, errors)

  const description = z
    .string()
    .trim()
    .min(1)
    .max(600)
    .optional()
    .safeParse(input.description)

  const author = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .safeParse(input.author)

  if (!description.success) errors.push('description must be 1-600 characters')

  if (!author.success) errors.push('author must be 1-200 characters')

  const python =
    input.python === undefined
      ? undefined
      : parsePythonDeclaration(input.python)

  if (python) errors.push(...python.errors)
  const capabilities = checkCapabilities(input.capabilities, errors)
  const scopes = checkScopes(input.scopes, errors)
  const contributions: ExtensionContributions = {}

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
      const parsed = checkNamedList(
        'object-actions',
        input.contributions['object-actions'],
        errors,
      )

      if (parsed !== null) contributions['object-actions'] = parsed
    }

    if (input.contributions.panels !== undefined) {
      const parsed = checkPanels(input.contributions.panels, errors)

      if (parsed !== null) contributions.panels = parsed
    }

    if (input.contributions.commands !== undefined) {
      const parsed = checkNamedList(
        'commands',
        input.contributions.commands,
        errors,
      )

      if (parsed !== null) contributions.commands = parsed
    }

    if (input.contributions['event-subscriptions'] !== undefined) {
      const parsed = checkEventSubscriptions(
        input.contributions['event-subscriptions'],
        errors,
      )

      if (parsed !== null) contributions['event-subscriptions'] = parsed
    }

    if (input.contributions.operations !== undefined) {
      const parsed = parseOperations(input.contributions.operations, errors)

      if (parsed !== null) contributions.operations = parsed
    }

    if (input.contributions['analysis-kinds'] !== undefined) {
      const parsed = parseAnalysisKinds(
        input.contributions['analysis-kinds'],
        errors,
      )

      if (parsed !== null) contributions['analysis-kinds'] = parsed
    }

    if (input.contributions.blocks !== undefined) {
      const parsed = parseBlocks(input.contributions.blocks, errors)

      if (parsed !== null) contributions.blocks = parsed
    }

    if (input.contributions['table-cells'] !== undefined) {
      const parsed = parseTableCells(input.contributions['table-cells'], errors)

      if (parsed !== null) contributions['table-cells'] = parsed
    }

    if (input.contributions.columns !== undefined) {
      const parsed = parseColumns(input.contributions.columns, errors)

      if (parsed !== null) contributions.columns = parsed
    }

    if (input.contributions['row-actions'] !== undefined) {
      const parsed = parseRowActions(input.contributions['row-actions'], errors)

      if (parsed !== null) contributions['row-actions'] = parsed
    }

    if (input.contributions['field-types'] !== undefined) {
      const parsed = parseFieldTypes(input.contributions['field-types'], errors)

      if (parsed !== null) contributions['field-types'] = parsed
    }

    for (const point of Object.keys(input.contributions)) {
      if (isDataPoint(point)) {
        const parsed = DATA_POINT_PARSERS[point](
          input.contributions[point],
          errors,
        )

        if (parsed !== null) Object.assign(contributions, { [point]: parsed })
      }
    }

    // Operations, calculators, pipeline steps and publishers share one name: plugin.<key>.<id>.
    const called = new Set<string>()

    for (const point of [
      'operations',
      'calculators',
      'pipeline-steps',
      'publishers',
    ]) {
      const entries = z.array(z.unknown()).safeParse(input.contributions[point])

      if (!entries.success) continue

      for (const entry of entries.data) {
        const identity = z.object({ id: z.string() }).safeParse(entry)

        if (!identity.success) continue

        if (called.has(identity.data.id))
          errors.push(
            `${identity.data.id} is used twice across operations, calculators, pipeline steps and publishers`,
          )
        called.add(identity.data.id)
      }
    }

    for (const point of EXTENSION_UI_POINTS) {
      if (input.contributions[point] !== undefined) {
        const parsed = parseUiPoint(point, input.contributions[point], errors)

        if (parsed !== null) Object.assign(contributions, { [point]: parsed })
      }
    }
  }

  if (
    errors.length > 0 ||
    id === null ||
    name === null ||
    version === null ||
    source === null ||
    capabilities === null ||
    scopes === null ||
    !description.success ||
    !author.success
  )
    return { value: null, errors }

  const value: ExtensionManifest = {
    id,
    name,
    version,
    source,
    capabilities,
    scopes,
    contributions,
  }

  if (compatibleWith !== null) value.compatibleWith = compatibleWith

  if (description.data !== undefined) value.description = description.data

  if (author.data !== undefined) value.author = author.data

  if (python?.value !== undefined) value.python = python.value

  return { value, errors }
}

/**
 * Validate a manifest value, returning every problem found. Never throws;
 * unknown contribution points, capabilities, scopes and event names are
 * reported, never silently dropped.
 */
export function validateExtensionManifest(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public manifest-validation boundary delegates to the same checked reader as installation; malformed-input and diagnostic-order regressions cover both paths.
  input: unknown,
): string[] {
  return readExtensionManifest(input).errors
}

/**
 * Validate and normalize a manifest: trims strings, dedupes authority,
 * resolves event aliases to canonical catalogue names. Throws
 * ExtensionManifestError listing every problem.
 */
export function parseExtensionManifest(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted manifest installation delegates every declaration to readExtensionManifest and rejects the entire result on any validation error.
  input: unknown,
): ExtensionManifest {
  const parsed = readExtensionManifest(input)

  if (parsed.value === null) throw new ExtensionManifestError(parsed.errors)

  return parsed.value
}

/** Validate a workspace-scoped install key; throws ExtensionManifestError. */
export function assertValidExtensionKey(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Install keys enter from callers as untrusted values; checkKey rejects values outside the key schema before a key is returned.
  key: unknown,
): string {
  const errors: string[] = []
  const ok = checkKey(key, errors)

  if (ok === null) throw new ExtensionManifestError(errors)

  return ok
}
