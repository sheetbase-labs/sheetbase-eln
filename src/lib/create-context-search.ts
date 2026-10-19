/**
 * The search params every create screen shares, so a page that links to one
 * hands over what it is about instead of making the person choose it again:
 * the project, experiment, sample, dataset or model in view, and where Cancel
 * (and a finished detour) should go back to.
 */
export interface CreateContextSearch {
  project?: string
  experiment?: string
  sample?: string
  dataset?: string
  model?: string
  /** An in-app path to return to; never an absolute URL. */
  returnTo?: string
}

const KEYS = [
  'project',
  'experiment',
  'sample',
  'dataset',
  'model',
] as const satisfies readonly (keyof CreateContextSearch)[]

/** An in-app path, or nothing: a `returnTo` must never leave the app. */
export function safeReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!value.startsWith('/') || value.startsWith('//')) return undefined
  if (value.includes('\\')) return undefined
  return value
}

/** Read the shared params from a route's raw search, dropping anything empty. */
export function parseCreateContext(
  search: Record<string, unknown>,
): CreateContextSearch {
  const out: CreateContextSearch = {}
  for (const key of KEYS) {
    const value = search[key]
    if (typeof value === 'string' && value) out[key] = value
  }
  const returnTo = safeReturnTo(search.returnTo)
  if (returnTo) out.returnTo = returnTo
  return out
}

/**
 * Where Cancel goes: the page the person came from, else the project they were
 * working in, else the list the create screen belongs to.
 */
export function cancelTarget(
  context: CreateContextSearch,
  fallback: string,
): string {
  if (context.returnTo) return context.returnTo
  if (context.project) return `/projects/${encodeURIComponent(context.project)}`
  return fallback
}
