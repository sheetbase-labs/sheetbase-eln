/**
 * Capability flags: which not-yet-built features are switched on in this
 * deployment.
 *
 * The UI branches on these flags instead of on a 404 or a guessed state, so a
 * screen whose capability is not built shows the honest CapabilityGap pattern
 * (`src/components/v3/ui/capability-gap.tsx`) rather than an error or fake
 * data. A capability arrives in a validated release, so the release sets the
 * flag; it is a deployment input, never a database row the UI can fake.
 *
 * `SHEETBASE_CAPABILITIES` is a comma-separated allow-list of enabled keys.
 * Unset means none of these capabilities are on.
 */
import { useQuery } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'

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
  const enabled = new Set(
    (env.SHEETBASE_CAPABILITIES ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  return Object.fromEntries(
    capabilityKeys.map((key) => [key, enabled.has(key)]),
  )
}

const getCapabilitiesFn = createServerFn({ method: 'GET' }).handler(async () =>
  capabilitiesFromEnv(),
)

/** Read the deployment capability flags once; they do not change at runtime. */
export function useCapabilities(): Capabilities {
  const query = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => getCapabilitiesFn(),
    staleTime: Infinity,
  })
  return query.data ?? noCapabilities
}
