/**
 * Deployment capability flags: the optional capabilities this deployment runs.
 *
 * A flag answers one question — does this deployment record measurements or
 * curated results in Sheetbase, or does that work live upstream? Both are
 * genuinely optional *per deployment*: a site whose values arrive from a QC
 * LIMS or whose results are curated outside the ELN turns the flag off, and the
 * matching tab says so honestly instead of showing a dead screen. A feature that
 * is simply unbuilt is not a flag: it uses the same
 * `CapabilityGap` component (`src/components/v3/ui/capability-gap.tsx`) with an
 * empty `instead` list, because no deployment can switch it on yet.
 *
 * These two are the whole vocabulary. The app-3 design demonstrates eleven
 * capability gaps, but the other nine are now real features in the ELN, so no
 * deployment switches them. (A surface that is simply unbuilt — the deployment
 * support bundle — renders `CapabilityGap` directly, with no flag.) A key earns
 * its place only when a screen branches on it.
 *
 * A flag never gates a permission. PostgreSQL RLS and `api.has_capability` stay
 * authoritative (`src/lib/capability.ts`); a capability is a deployment input,
 * never a database row the UI can fake, and never a substitute for a denied
 * notice.
 *
 * `SHEETBASE_CAPABILITIES` is a comma-separated allow-list of enabled keys.
 * Unset means every capability is off. A deployment that records measurements
 * sets `SHEETBASE_CAPABILITIES=sampleMeasurements`.
 *
 * The flags reach the interface through the root route's deployment context
 * (`RouterContext.capabilities`, built once per request in `src/routes/__root.tsx`),
 * so a screen branches on them at first paint rather than flashing a gap and
 * then real data.
 */

export const capabilityKeys = [
  'sampleMeasurements',
  'experimentResults',
] as const

export type CapabilityKey = (typeof capabilityKeys)[number]
export type Capabilities = Record<CapabilityKey, boolean>

/** The all-off baseline: what the UI shows when nothing is enabled. */
export const noCapabilities: Capabilities = Object.fromEntries(
  capabilityKeys.map((key) => [key, false]),
) as Capabilities

/** Roadmap item tracking each gap; CapabilityGap shows it to admins only. */
export const capabilityRoadmap: Record<CapabilityKey, string> = {
  sampleMeasurements: 'RM-112',
  experimentResults: 'RM-118',
}

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
  ) as Capabilities
}
