import type { DataClient } from './data-client'

/**
 * A dependency row's liveness, as `discover_object_dependencies` reports it.
 * The SQL builds these labels as text and callers only test one of them
 * (`'active'` marks a row that still exists), so the contract is the database's
 * text rather than a closed union a new SQL branch could break. Today's values
 * are `active`, `historical` and `informational`.
 */
export type DependencyLiveness = string

/**
 * What deleting the object would do to this dependency. Also text from the
 * same SQL: today `blocks_deletion`, `requires_migration` and `informational`.
 */
export type DependencyEffect = string

export interface ObjectDependency {
  kind: string
  id: string
  relation: string
  liveness: DependencyLiveness
  effect: DependencyEffect
  label: string
}

export interface DependencyDiscovery {
  kind: string
  id: string
  dependencies: ObjectDependency[]
}

export interface HardDeletePreview extends DependencyDiscovery {
  allowed: boolean
  blocking: ObjectDependency[]
}

export async function discoverObjectDependencies(
  client: DataClient,
  kind: string,
  objectId: string,
): Promise<DependencyDiscovery> {
  return client.rpc('discover_object_dependencies', {
    p_kind: kind,
    p_object_id: objectId,
  })
}

export async function previewHardDelete(
  client: DataClient,
  kind: string,
  objectId: string,
): Promise<HardDeletePreview> {
  return client.rpc('preview_hard_delete', {
    p_kind: kind,
    p_object_id: objectId,
  })
}
