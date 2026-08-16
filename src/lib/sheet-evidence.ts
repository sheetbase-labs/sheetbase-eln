export type FrozenSheetEvidence = {
  blockId: string
  instanceId: string
  instanceRevision: number
  sourceDefinitionVersionId: string | null
  instanceState: Record<string, unknown>
  datasetBindings: Array<Record<string, unknown>>
  composedGrid?: {
    columns?: Array<{ id?: unknown; label?: unknown }>
    rows?: unknown
  } | null
}

export function sheetEvidenceFromRevisionRows(
  rows: Array<{
    block_id: string
    instance_id: string
    instance_revision: number | string
    source_definition_version_id: string | null
    instance_state: Record<string, unknown> | null
    dataset_versions: unknown
    composed_grid: unknown
  }>,
): Map<string, FrozenSheetEvidence> {
  const map = new Map<string, FrozenSheetEvidence>()
  for (const row of rows) {
    map.set(row.block_id, {
      blockId: row.block_id,
      instanceId: row.instance_id,
      instanceRevision: Number(row.instance_revision ?? 0),
      sourceDefinitionVersionId: row.source_definition_version_id,
      instanceState: row.instance_state ?? {},
      datasetBindings: Array.isArray(row.dataset_versions)
        ? (row.dataset_versions as Array<Record<string, unknown>>)
        : [],
      composedGrid:
        row.composed_grid && typeof row.composed_grid === 'object'
          ? (row.composed_grid as FrozenSheetEvidence['composedGrid'])
          : null,
    })
  }
  return map
}

export function sheetEvidenceFromEnvelope(
  envelope: { sheetEvidence?: unknown } | null | undefined,
): Map<string, FrozenSheetEvidence> {
  const items = envelope?.sheetEvidence
  const map = new Map<string, FrozenSheetEvidence>()
  if (!Array.isArray(items)) return map
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.blockId !== 'string' || typeof row.instanceId !== 'string') {
      continue
    }
    map.set(row.blockId, {
      blockId: row.blockId,
      instanceId: row.instanceId,
      instanceRevision: Number(row.instanceRevision ?? 0),
      sourceDefinitionVersionId:
        typeof row.sourceDefinitionVersionId === 'string'
          ? row.sourceDefinitionVersionId
          : null,
      instanceState:
        row.instanceState && typeof row.instanceState === 'object'
          ? (row.instanceState as Record<string, unknown>)
          : {},
      datasetBindings: Array.isArray(row.datasetBindings)
        ? (row.datasetBindings as Array<Record<string, unknown>>)
        : [],
      composedGrid:
        row.composedGrid && typeof row.composedGrid === 'object'
          ? (row.composedGrid as FrozenSheetEvidence['composedGrid'])
          : null,
    })
  }
  return map
}
