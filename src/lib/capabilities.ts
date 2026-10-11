/**
 * Deployment capability flags: capabilities this deployment does not have.
 *
 * A flag answers one question — is a capability absent from *this deployment*
 * while the product itself has it? It is a deployment input
 * (`SHEETBASE_CAPABILITIES`, a comma-separated allow-list of the registered
 * keys; unset means none of them are on), never a database row the UI can fake,
 * and never a substitute for a denied notice. A flag never gates a permission:
 * PostgreSQL RLS and `api.has_capability` stay authoritative.
 *
 * **No key is registered today, and nothing is gated.** The app-3 design
 * demonstrated eleven capability gaps; Roadmap 4 built all of them, so no
 * deployment switches any of them off. The surfaces that are still unbuilt (the
 * deployment support bundle, the support-request form) are unbuilt for every
 * deployment, so they render `CapabilityGap`
 * (`src/components/v3/ui/capability-gap.tsx`) directly rather than behind a
 * flag.
 *
 * Register a key only when a screen must branch on a capability a deployment
 * may genuinely not have — and only when the gap copy is true in the default
 * state. A shipped feature must never default to a gap: "not in this release
 * yet" would be a false statement about a feature that is in this release, and
 * it hides working surfaces from every fresh deployment until someone sets an
 * environment variable. A site that wants to switch a shipped surface off (say
 * it records measurements in a QC LIMS) is expressing a preference, not a
 * capability gap, and needs its own explicit mechanism and copy.
 *
 * The flags reach the interface through the root route's deployment context
 * (`RouterContext.capabilities`, built once per request in `src/routes/__root.tsx`),
 * so a screen branches on them at first paint rather than flashing a gap and
 * then real data.
 */

export const capabilityKeys = [] as const

export type CapabilityKey = (typeof capabilityKeys)[number]
export type Capabilities = Record<CapabilityKey, boolean>

/** The all-off baseline: what the UI shows when nothing is enabled. */
export const noCapabilities: Capabilities = Object.fromEntries(
  capabilityKeys.map((key) => [key, false]),
)

/** Roadmap item tracking each gap; CapabilityGap shows it to admins only. */
export const capabilityRoadmap: Record<CapabilityKey, string> = {}

/** Parse the deployment allow-list. Pure, so it is unit-testable. */
export function capabilitiesFromEnv(
  env: Record<string, string | undefined> = process.env,
): Capabilities {
  const enabled = (env.SHEETBASE_CAPABILITIES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return Object.fromEntries(
    capabilityKeys.map((key) => [key, enabled.includes(key)]),
  )
}
