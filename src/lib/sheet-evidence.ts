export type FrozenSheetEvidence = {
  blockId: string
  instanceId: string
  instanceRevision: number
  sourceDefinitionVersionId: string | null
  instanceState: Record<string, unknown>
  datasetBindings: Array<Record<string, unknown>>
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
    })
  }
  return map
}
