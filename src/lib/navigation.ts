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
  return `/materials?selected=${encodeURIComponent(reagentId)}`
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
      // The palette opens the record itself (its notebook), not the owning
      // registry with the row selected.
      return recordPath(recordId)
  }
}

/** One breadcrumb entry; `to` is present only when the ancestor is resolvable. */
export interface NavigationBreadcrumb {
  label: string
  to?: string
}

/**
 * Context-preserving breadcrumbs for a canonical object page.
 *
 * Ancestors are derived from stable IDs carried by the object itself
 * (workspace → project → owning record), never from browser history or the
 * page the user arrived from. Following a relationship link therefore lands
 * on a page whose context can be reconstructed from the object's own
 * identity, and returning via a breadcrumb link preserves that context.
 */
export function objectContextBreadcrumbs(options: {
  objectLabel: string
  project?: { id: string; title: string } | null
  owningRecord?: { id: string; title: string } | null
}): NavigationBreadcrumb[] {
  const crumbs: NavigationBreadcrumb[] = [{ label: 'Home', to: '/' }]
  if (options.project || options.owningRecord) {
    crumbs.push({ label: 'Projects', to: '/projects' })
  }
  if (options.project) {
    crumbs.push({
      label: options.project.title,
      to: projectPath(options.project.id),
    })
  }
  if (options.owningRecord) {
    crumbs.push({
      label: options.owningRecord.title,
      to: recordPath(options.owningRecord.id),
    })
  }
  crumbs.push({ label: options.objectLabel })
  return crumbs
}
