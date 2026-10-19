/**
 * Canonical product destinations. Object identity is always carried by the
 * object's stable UUID; project and folder placement provide context but do
 * not form part of an object's canonical URL.
 */

import { z } from 'zod'

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
  return `/samples/${encodeURIComponent(sampleId)}`
}

export function reagentPath(reagentId: string): string {
  return `/materials/${encodeURIComponent(reagentId)}`
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
    case 'material':
      return reagentPath(recordId)
    case 'protocol_template':
      return protocolTemplatePath(recordId)
    default:
      return recordPath(recordId)
  }
}

/**
 * The kinds of object whose identifier is shown as a link. Every route that
 * owns one accepts both its UUID and its display identifier (`DS-0311`), so a
 * link needs no lookup first: `objectPath('dataset', 'DS-0311')` is enough.
 */
export type ObjectKind =
  | 'project'
  | 'experiment'
  | 'record'
  | 'sample'
  | 'material'
  | 'dataset'
  | 'instrument'
  | 'sheet'
  | 'pipeline'
  | 'pipeline_run'
  | 'analysis'
  | 'protocol_template'
  | 'review'

/** Record kinds shown as experiments, so a link opens the experiment page. */
const OBJECT_KIND_ALIASES: Record<string, ObjectKind> = {
  protocol: 'protocol_template',
  reagent: 'material',
  analysis_view: 'analysis',
  dataset_import: 'dataset',
}

/** The object kinds `objectPath` can link to; others render as plain text. */
export function isLinkableObjectKind(kind: string): kind is ObjectKind {
  return objectPath(kind, 'x') !== null
}

/**
 * The page that owns an object, from its kind and either identifier. Returns
 * null for a kind with no page of its own, so callers fall back to text
 * instead of inventing a destination.
 */
export function objectPath(kind: string, ref: string): string | null {
  const key = encodeURIComponent(ref)
  switch (OBJECT_KIND_ALIASES[kind] ?? kind) {
    case 'project':
      return `/projects/${key}`
    case 'experiment':
      return `/experiments/${key}`
    case 'record':
      return recordPath(ref)
    case 'sample':
      return samplePath(ref)
    case 'material':
      return reagentPath(ref)
    case 'dataset':
      return `/datasets/${key}`
    case 'instrument':
      return `/instruments/${key}`
    case 'sheet':
      return sheetPath(ref)
    case 'pipeline':
      return `/pipelines/${key}`
    case 'pipeline_run':
      return `/pipelines/runs/${key}`
    case 'analysis':
      return `/analysis/${key}`
    case 'protocol_template':
      return protocolTemplatePath(ref)
    case 'review':
      return `/review/${key}`
    default:
      return null
  }
}

export type CanonicalSearchResultType =
  'record' | 'file' | 'dataset' | 'sheet' | 'template' | 'comment'

export function searchResultDestination(
  resultType: CanonicalSearchResultType,
  recordId: string,
  ownerScopedLink?: string,
): string {
  switch (resultType) {
    case 'comment': {
      // The hit UUID is not a Record UUID. Only the authority can provide its
      // visible owner, and the browser accepts no external or invented context.
      const base = 'https://sheetbase.invalid'
      const url = new URL(ownerScopedLink ?? '', base)
      const path = url.pathname.split('/')
      const frozen = path[1] === 'review'
      if (
        !ownerScopedLink?.startsWith('/') ||
        url.origin !== base ||
        url.hash ||
        path.length !== 3 ||
        (!frozen && path[1] !== 'sheets') ||
        !z.uuid().safeParse(path[2]).success ||
        !z.uuid().safeParse(recordId).success ||
        url.searchParams.get('commentId') !== recordId ||
        url.searchParams.size !== (frozen ? 2 : 1) ||
        (frozen && url.searchParams.get('tab') !== 'comments')
      )
        throw new Error(
          'Comment search requires a valid owner-scoped destination.',
        )
      return ownerScopedLink
    }
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
