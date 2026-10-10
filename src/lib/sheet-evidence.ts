export type FrozenSheetEvidence = {
  blockId: string
  instanceId: string
  instanceRevision: number
  sourceDefinitionVersionId: string | null
  instanceState: Record<string, unknown>
  datasetBindings: Array<Record<string, unknown>>
  composedGrid?: {
    columns?: Array<Record<string, unknown>>
    rowKeys?: unknown
    rows?: unknown
    fields?: unknown
    calculations?: unknown
  } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseComposedGrid(
  value: unknown,
): FrozenSheetEvidence['composedGrid'] {
  if (!isRecord(value)) return null
  return {
    columns: Array.isArray(value.columns)
      ? value.columns.map((column) => {
          if (!isRecord(column)) return {}
          return column
        })
      : undefined,
    rowKeys: value.rowKeys,
    rows: value.rows,
    fields: value.fields,
    calculations: value.calculations,
  }
}

function parseBindings(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
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
      instanceRevision: Number(row.instance_revision),
      sourceDefinitionVersionId: row.source_definition_version_id,
      instanceState: row.instance_state ?? {},
      datasetBindings: parseBindings(row.dataset_versions),
      composedGrid: parseComposedGrid(row.composed_grid),
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
    if (!isRecord(item)) continue
    if (
      typeof item.blockId !== 'string' ||
      typeof item.instanceId !== 'string'
    ) {
      continue
    }
    map.set(item.blockId, {
      blockId: item.blockId,
      instanceId: item.instanceId,
      instanceRevision: Number(item.instanceRevision ?? 0),
      sourceDefinitionVersionId:
        typeof item.sourceDefinitionVersionId === 'string'
          ? item.sourceDefinitionVersionId
          : null,
      instanceState: isRecord(item.instanceState) ? item.instanceState : {},
      datasetBindings: parseBindings(item.datasetBindings),
      composedGrid: parseComposedGrid(item.composedGrid),
    })
  }
  return map
}
