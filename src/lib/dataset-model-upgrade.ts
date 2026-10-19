import type { DataClient } from './data-client'

export interface ModelVersionOption {
  id: string
  version: number
}

export interface DatasetModelPosition {
  datasetRevision: number
  currentVersionId: string
  currentVersion: number
  /** Published versions of the same model that are newer, oldest first. */
  newer: ModelVersionOption[]
}

export interface DatasetModelUpgradePreview {
  ok: boolean
  blocked: boolean
  reason: string | null
  fromVersion: number
  toVersion: number
  toVersionId: string
  added: Array<{ key: string; label: string; type: string }>
  removed: Array<{ key: string; label: string }>
  retyped: Array<{ key: string; label: string; from: string; to: string }>
  requiredWithoutDefault: Array<{ key: string; label: string }>
  rowCount: number
  datasetRevision: number
  applied?: boolean
}

/** Where the dataset sits on its model, and which published versions are ahead. */
export async function fetchDatasetModelPosition(
  client: DataClient,
  datasetId: string,
): Promise<DatasetModelPosition | null> {
  const dataset = (
    await client.list<{ revision: number | string; schema_version_id: string }>(
      'datasets',
      `?id=eq.${encodeURIComponent(datasetId)}&select=revision,schema_version_id`,
    )
  ).at(0)
  if (!dataset) return null
  const current = (
    await client.list<{ id: string; schema_id: string; version: number }>(
      'dataset_schema_versions',
      `?id=eq.${dataset.schema_version_id}&select=id,schema_id,version`,
    )
  ).at(0)
  if (!current) return null
  const newer = await client.list<ModelVersionOption>(
    'dataset_schema_versions',
    `?schema_id=eq.${current.schema_id}&lifecycle=eq.active` +
      `&version=gt.${current.version}&select=id,version&order=version.asc`,
  )
  return {
    datasetRevision: Number(dataset.revision),
    currentVersionId: current.id,
    currentVersion: current.version,
    newer,
  }
}

export function previewDatasetModelUpgrade(
  client: DataClient,
  datasetId: string,
  targetVersionId: string,
): Promise<DatasetModelUpgradePreview> {
  return client.rpc('preview_dataset_model_upgrade', {
    p_dataset_id: datasetId,
    p_target_version_id: targetVersionId,
  })
}

export function applyDatasetModelUpgrade(
  client: DataClient,
  input: {
    datasetId: string
    targetVersionId: string
    expectedRevision: number
  },
): Promise<DatasetModelUpgradePreview> {
  return client.rpc('apply_dataset_model_upgrade', {
    p_dataset_id: input.datasetId,
    p_target_version_id: input.targetVersionId,
    p_expected_revision: input.expectedRevision,
  })
}

/** One line per consequence of the move, for the preview. */
export function describeUpgradeEffects(
  preview: DatasetModelUpgradePreview,
): string[] {
  const lines: string[] = []
  if (preview.added.length)
    lines.push(
      `Adds ${preview.added.map((f) => f.label).join(', ')}. Existing rows leave ${
        preview.added.length === 1 ? 'it' : 'them'
      } empty until filled in.`,
    )
  if (
    !preview.added.length &&
    !preview.removed.length &&
    !preview.retyped.length
  )
    lines.push('No field changes. Only the version the dataset follows moves.')
  lines.push(
    `${preview.rowCount} ${preview.rowCount === 1 ? 'row keeps' : 'rows keep'} every value. Snapshots already taken stay on v${preview.fromVersion}.`,
  )
  return lines
}
