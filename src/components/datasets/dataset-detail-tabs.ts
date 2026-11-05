/**
 * R5-SURF-01 — the dataset detail's data tabs.
 *
 * The design gives a dataset six tabs (Rows, Snapshots, Columns, Imports,
 * Used by, History). The ELN's frame already routes Rows, Snapshots and
 * Compare; Imports, Used by and History are selected by the `view` search
 * parameter on the dataset detail route so each is a linkable, reloadable URL
 * (`/datasets/<id>?view=imports`) without a second route tree.
 *
 * Columns is deliberately NOT added: the interface's own screen is a stub and
 * column identity is already reachable through the Rows grid headers and the
 * Model Fields tab, so a Columns tab would be a second, thinner view of the
 * same facts. A later audit should not re-open this.
 */
import { DataClientError } from '#/lib/data-client'

export const datasetDetailTabs = ['imports', 'used-by', 'history'] as const
export type DatasetDetailTab = (typeof datasetDetailTabs)[number]

export function isDatasetDetailTab(value: unknown): value is DatasetDetailTab {
  return (
    typeof value === 'string' &&
    (datasetDetailTabs as readonly string[]).includes(value)
  )
}

/**
 * Honest tab states: a denied read is not an empty result. The `/api/db` proxy
 * maps insufficient privilege to `permission_denied`; the raw PostgREST code
 * (`42501`) is accepted too so a direct RPC error is classified the same way.
 */
export type DatasetTabAccess = 'denied' | 'error'

export function classifyDatasetTabAccess(
  error: unknown,
): DatasetTabAccess | null {
  if (!error) return null
  if (
    error instanceof DataClientError &&
    (error.code === 'permission_denied' ||
      error.code === 'unauthenticated' ||
      error.code === '42501')
  ) {
    return 'denied'
  }
  return 'error'
}
