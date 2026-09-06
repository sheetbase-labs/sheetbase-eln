/**
 * EXT-02 — Extension-point registry and invocation gate.
 *
 * EXT-01 stores each install's declared contributions (object-actions,
 * panels, commands, event-subscriptions) and validates them fail-closed.
 * This module resolves those declarations into the renderable points the
 * product surfaces mount — one registry for every surface, so record,
 * dataset, inspector-panel and palette renderers never invent their own
 * filtering:
 *
 * - Only `enabled` installs contribute anything. `installed` and
 *   `disabled` installs resolve to empty points (fail-closed).
 * - Only the three UI points resolve here. `event-subscriptions` belong
 *   to the delivery engine, not to renderers, and unknown points are
 *   ignored defensively (manifest validation already rejects them).
 * - Gating is per contribution via `effectiveExtensionCapabilities`
 *   (EXT-01): a declaration may carry an optional `capability` hint naming
 *   one of the manifest's declared capabilities; the contribution renders
 *   only when the caller's role actually holds it. A hint naming an
 *   undeclared capability drops that declaration fail-closed. Hint-less
 *   declarations (read-only affordances needing no authority) render for
 *   any workspace member; signed-out or role-less callers see nothing.
 * - Invocation re-checks server-side via `api.assert_extension_capability`
 *   before running anything: the client-side gate only hides UI, the RPC
 *   is the enforcement. The helper returns the stable
 *   `extensionAuditIdentity` fragment so callers stamp extension-attributed
 *   work into their canonical payload channel; read-only affordances
 *   (panel opens, navigation) carry no durable write, so for them the
 *   assert is the enforcement and the fragment is returned unused.
 *
 * Extensions never own canonical state through this path: the `operation`
 * callback runs ordinary canonical operations (navigation, public domain
 * reads/writes, event subscriptions) through the caller's own client.
 * Contributed UI must render through existing primitives (buttons,
 * dialogs, palette groups); this module is deliberately render-free so
 * the host surfaces keep owning labels, focus and layout.
 */
import type { DataClient } from '../data-client'
import type { Capability } from '../capability'
import {
  effectiveExtensionCapabilities,
  extensionAuditIdentity,
} from './contract'
import type { ExtensionAuditIdentity } from './contract'
import { parseExtensionManifest } from './manifest'
import type { ExtensionManifest } from './manifest'

/** UI points this registry resolves. Event subscriptions deliver; they do not render. */
export const EXTENSION_UI_POINTS = [
  'object-actions',
  'panels',
  'commands',
] as const

export type ExtensionUiPoint = (typeof EXTENSION_UI_POINTS)[number]

/** Minimal install shape the registry needs. Accepts `ExtensionWire` directly. */
export interface ExtensionInstallLike {
  id: string
  key: string
  status: string
  manifest: unknown
}

/** One renderable contribution, namespaced by its owning extension. */
export interface ResolvedExtensionContribution {
  extensionId: string
  extensionKey: string
  manifestId: string
  manifestVersion: string
  point: ExtensionUiPoint
  /** Declaration id, unique within the extension + point. */
  id: string
  title: string
  /**
   * Capability asserted at invoke time, or null for authority-free
   * read-only affordances. Never names an undeclared capability: such
   * declarations are dropped at resolve time.
   */
  requiredCapability: Capability | null
  /** React/render key: stable across resolves for one install + declaration. */
  key: string
}

export interface ResolvedExtensionPoints {
  objectActions: ResolvedExtensionContribution[]
  panels: ResolvedExtensionContribution[]
  commands: ResolvedExtensionContribution[]
}

const EMPTY_POINTS: ResolvedExtensionPoints = {
  objectActions: [],
  panels: [],
  commands: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the raw declaration extras EXT-01 normalizes away. Only `capability`
 * is honoured, and only when it names a capability the manifest declares;
 * every other extra is ignored so future manifest fields stay
 * forward-compatible without changing resolution.
 */
function readCapabilityHint(
  rawManifest: unknown,
  point: ExtensionUiPoint,
  declarationId: string,
  declared: ReadonlySet<string>,
): { hint: Capability | null; rejected: boolean } {
  if (!isRecord(rawManifest)) return { hint: null, rejected: false }
  const contributions = rawManifest.contributions
  if (!isRecord(contributions)) return { hint: null, rejected: false }
  const list = contributions[point]
  if (!Array.isArray(list)) return { hint: null, rejected: false }
  const raw = list.find(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && entry.id === declarationId,
  )
  const hint = raw?.capability
  if (hint === undefined) return { hint: null, rejected: false }
  if (typeof hint !== 'string' || !declared.has(hint)) {
    // Fail closed: a declaration claiming authority the manifest never
    // asked for (or a misspelled capability) never renders.
    return { hint: null, rejected: true }
  }
  return { hint: hint as Capability, rejected: false }
}

/**
 * Resolve every install's declared UI contributions for a caller role.
 * Pure and total: unparsable manifests, non-enabled installs and
 * ungated-for-this-role declarations contribute nothing, never an error.
 */
export function resolveExtensionContributions(
  installs: readonly ExtensionInstallLike[],
  role: string | null | undefined,
): ResolvedExtensionPoints {
  if (!role) return { ...EMPTY_POINTS }
  const objectActions: ResolvedExtensionContribution[] = []
  const panels: ResolvedExtensionContribution[] = []
  const commands: ResolvedExtensionContribution[] = []
  const buckets: Record<ExtensionUiPoint, ResolvedExtensionContribution[]> = {
    'object-actions': objectActions,
    panels,
    commands,
  }
  for (const install of installs) {
    if (install.status !== 'enabled') continue
    let manifest: ExtensionManifest
    try {
      manifest = parseExtensionManifest(install.manifest)
    } catch {
      continue
    }
    const granted = new Set<Capability>(
      effectiveExtensionCapabilities(manifest, role),
    )
    const declared = new Set<string>(manifest.capabilities)
    const points: ExtensionUiPoint[] = ['object-actions', 'panels', 'commands']
    for (const point of points) {
      const declarations = manifest.contributions[point] ?? []
      for (const declaration of declarations) {
        const { hint, rejected } = readCapabilityHint(
          install.manifest,
          point,
          declaration.id,
          declared,
        )
        if (rejected) continue
        if (hint !== null && !granted.has(hint)) continue
        buckets[point].push({
          extensionId: install.id,
          extensionKey: install.key,
          manifestId: manifest.id,
          manifestVersion: manifest.version,
          point,
          id: declaration.id,
          title: declaration.title,
          requiredCapability: hint,
          key: `${install.key}:${point}:${declaration.id}`,
        })
      }
    }
  }
  // Deterministic order: extension key, then point, then declaration id —
  // hosts render this order verbatim so repeated resolves never reshuffle.
  const byKey = (
    a: ResolvedExtensionContribution,
    b: ResolvedExtensionContribution,
  ) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  objectActions.sort(byKey)
  panels.sort(byKey)
  commands.sort(byKey)
  return { objectActions, panels, commands }
}

/** Stable audit fragment for an invocation; stamp into canonical payloads. */
export function extensionInvocationAudit(
  contribution: Pick<
    ResolvedExtensionContribution,
    'extensionId' | 'extensionKey' | 'manifestId' | 'manifestVersion'
  >,
): ExtensionAuditIdentity {
  return extensionAuditIdentity({
    extensionId: contribution.extensionId,
    extensionKey: contribution.extensionKey,
    manifest: {
      id: contribution.manifestId,
      version: contribution.manifestVersion,
    },
  })
}

export interface ExtensionInvocationResult<T> {
  result: T
  audit: ExtensionAuditIdentity
}

/**
 * Invoke an extension contribution through the enforcement gate.
 *
 * 1. When the contribution requires a capability, assert it server-side via
 *    `api.assert_extension_capability` (enabled + declared + caller holds).
 *    Any failure throws before `operation` runs — fail-closed.
 * 2. Run `operation`: the ordinary canonical work (a public domain
 *    read/write, navigation arranged by the host, an event subscription).
 *    The extension receives no privileged handle; it acts as the caller.
 * 3. Return the audit fragment alongside the result. Callers performing a
 *    durable write stamp `audit` into their canonical payload channel; for
 *    read-only affordances there is no durable write to stamp.
 */
export async function invokeExtensionContribution<T>(
  client: DataClient,
  workspaceId: string,
  contribution: ResolvedExtensionContribution,
  operation: () => Promise<T>,
): Promise<ExtensionInvocationResult<T>> {
  if (contribution.requiredCapability !== null) {
    await client.rpc('assert_extension_capability', {
      p_workspace_id: workspaceId,
      p_extension_id: contribution.extensionId,
      p_capability: contribution.requiredCapability,
    })
  }
  const result = await operation()
  return { result, audit: extensionInvocationAudit(contribution) }
}

/** Human-readable invocation failures; never leaks server internals. */
export function describeExtensionInvocationError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/not enabled/i.test(message)) {
    return 'That extension is no longer enabled in this workspace.'
  }
  if (/capability required/i.test(message)) {
    return 'You do not have permission to run that extension action.'
  }
  if (/extension not found/i.test(message)) {
    return 'That extension is no longer installed in this workspace.'
  }
  return message
}
