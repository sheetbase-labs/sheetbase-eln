import type { DataClient } from './data-client'

export type DependencyLiveness = 'active' | 'historical' | 'informational'
export type DependencyEffect =
  'blocks_deletion' | 'requires_migration' | 'informational'

export interface ObjectDependency {
  kind: string
  id: string
  relation: string
  liveness: DependencyLiveness | string
  effect: DependencyEffect | string
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
