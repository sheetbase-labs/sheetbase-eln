/**
 * Canonical product destinations. Object identity is always carried by the
 * object's stable UUID; project and folder placement provide context but do
 * not form part of an object's canonical URL.
 */

export function projectPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`
}

export function recordPath(recordId: string): string {
  return `/records/${encodeURIComponent(recordId)}`
}

export function datasetPath(datasetId: string): string {
  return `/datasets?dataset=${encodeURIComponent(datasetId)}`
}

export function sheetPath(sheetId: string): string {
  return `/sheets/${encodeURIComponent(sheetId)}`
}

export function samplePath(sampleId: string): string {
  return `/samples?selected=${encodeURIComponent(sampleId)}`
}

export function reagentPath(reagentId: string): string {
  return `/reagents?selected=${encodeURIComponent(reagentId)}`
}

export function notebookTemplatePath(templateId: string): string {
  return `/templates?template=${encodeURIComponent(templateId)}`
}

export function protocolTemplatePath(templateRecordId: string): string {
  return `/templates?protocol=${encodeURIComponent(templateRecordId)}`
}

/** Resolve a polymorphic record to the product surface that owns it. */
export function recordDestination(kind: string, recordId: string): string {
  switch (kind) {
    case 'sample':
      return samplePath(recordId)
    case 'reagent':
      return reagentPath(recordId)
    case 'protocol_template':
      return protocolTemplatePath(recordId)
    default:
      return recordPath(recordId)
  }
}

export type CanonicalSearchResultType =
  'record' | 'file' | 'dataset' | 'sheet' | 'template'

export function searchResultDestination(
  resultType: CanonicalSearchResultType,
  kind: string,
  recordId: string,
): string {
  switch (resultType) {
    case 'dataset':
      return datasetPath(recordId)
    case 'sheet':
      return sheetPath(recordId)
    case 'template':
      return notebookTemplatePath(recordId)
    default:
      return recordDestination(kind, recordId)
  }
}
