import { z } from 'zod'

/**
 * The assistant's one way to drive the screen: put pages in panes. It names
 * pages by kind and id, never by address, so it cannot send anyone elsewhere.
 * The server checks the request; the browser then lays the panes out through
 * the same workspace actions a person uses.
 */

export const WORKSPACE_TOOL_NAME = 'sheetbase.workspace.open'
export const COMPOSE_WORKSPACE_EVENT = 'sheetbase:assistant-workspace'

/** Most panes one request may open. */
export const MAX_WORKSPACE_PANES = 4

const RECORD_ROUTES = [
  'experiments',
  'samples',
  'materials',
  'protocols',
  'instruments',
  'datasets',
  'sheets',
  'analysis',
  'records',
] as const

/** Pages that are only ever lists: the lab's day-to-day areas. */
const LIST_ONLY_ROUTES = [
  'schedule',
  'requests',
  'shipments',
  'plates',
  'incidents',
  'registry',
  'inbox',
  'projects',
  'reports',
  'pipelines',
  'stocktake',
] as const

const LIST_ROUTES = [
  'experiments',
  'samples',
  'materials',
  'protocols',
  'instruments',
  'datasets',
  'analysis',
  ...LIST_ONLY_ROUTES,
] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const workspaceRequestSchema = z
  .object({
    pages: z
      .array(
        z
          .object({
            route: z.enum([...RECORD_ROUTES, ...LIST_ONLY_ROUTES]),
            id: z.string().regex(UUID).optional(),
            title: z.string().max(80).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_WORKSPACE_PANES),
    layout: z
      .enum(['columns-2', 'columns-3', 'primary-context', 'rows-2'])
      .optional(),
    newWorkspace: z.boolean().optional(),
    name: z.string().max(60).optional(),
  })
  .strict()

export interface WorkspaceComposeRequest {
  pages: Array<{ href: string; title?: string }>
  layout?: 'columns-2' | 'columns-3' | 'primary-context' | 'rows-2'
  newWorkspace: boolean
  name?: string
}

/** `null` when the request is not something the assistant may open. */
export function parseWorkspaceRequest(
  args: unknown,
): WorkspaceComposeRequest | null {
  const parsed = workspaceRequestSchema.safeParse(args)
  if (!parsed.success) return null
  const pages: WorkspaceComposeRequest['pages'] = []
  for (const page of parsed.data.pages) {
    if (page.id === undefined) {
      if (!(LIST_ROUTES as readonly string[]).includes(page.route)) return null
      pages.push({ href: `/${page.route}`, title: page.title })
    } else {
      if ((LIST_ONLY_ROUTES as readonly string[]).includes(page.route)) {
        return null
      }
      pages.push({ href: `/${page.route}/${page.id}`, title: page.title })
    }
  }
  return {
    pages,
    layout: parsed.data.layout,
    newWorkspace: parsed.data.newWorkspace === true,
    name: parsed.data.name,
  }
}

export function requestAssistantWorkspace(request: WorkspaceComposeRequest) {
  window.dispatchEvent(
    new CustomEvent(COMPOSE_WORKSPACE_EVENT, { detail: request }),
  )
}

export function registerAssistantWorkspace(
  compose: (request: WorkspaceComposeRequest) => void,
) {
  const listener = (event: Event) => {
    if (!(event instanceof CustomEvent)) return
    compose(event.detail as WorkspaceComposeRequest)
  }
  window.addEventListener(COMPOSE_WORKSPACE_EVENT, listener)
  return () => window.removeEventListener(COMPOSE_WORKSPACE_EVENT, listener)
}
