import {
  datasetPath,
  datasetVersionPath,
  recordDestination,
} from '#/lib/navigation'

/** A citation opens its pin, never the current dataset or its display label. */
export function linkedRecordDestination({
  targetKind,
  targetId,
  datasetVersionId,
  partNumber,
}: {
  targetKind: string
  targetId?: string | null
  datasetVersionId?: string | null
  partNumber?: number | null
}): string | null {
  if (!targetId) return null

  if (targetKind === 'dataset') {
    return datasetVersionId
      ? datasetVersionPath(targetId, datasetVersionId)
      : datasetPath(targetId)
  }

  if (partNumber) return `/experiments/${targetId}/notebook/${partNumber}`

  return recordDestination(targetKind, targetId)
}
