/**
 * Display-identifier resolution (DSYS-06). The design and the URL contract
 * address entities by their stable display identifier (`PRJ-0217`, `EXP-0142`,
 * `SMP-2231`, `DS-0311`, `INS-0007`, `SHT-0019`, `CB-0012`, `PL-0003`), while
 * the app addresses rows by UUID. Route `beforeLoad` calls
 * `resolveIdentifierParam` so both forms work; a resolved identifier redirects
 * to the canonical UUID URL, so links and the URL bar stay UUID-based.
 *
 * The lookup itself is server-side (`identifier-resolution.server.ts`) and
 * runs under the caller's session claims, so PostgREST row-level security and
 * an explicit workspace filter keep one workspace from resolving another's
 * identifier. An unresolved identifier (missing, or another workspace's)
 * is left untouched: the route renders its own not-found state.
 */
import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'

/** The entity families a route can address by display identifier. */
export type IdentifierEntity =
  | 'project'
  | 'experiment'
  | 'sample'
  | 'dataset'
  | 'instrument'
  | 'sheet'
  | 'record'
  | 'pipeline'
  | 'analysis'
  | 'review'

export interface ResolveIdentifierInput {
  entity: IdentifierEntity
  identifier: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Canonical row ids are UUIDs; anything else is treated as a display id. */
export function isUuid(value: string): boolean {
  return UUID.test(value)
}

const resolveIdentifierFn = createServerFn({ method: 'POST' })
  .validator((input: ResolveIdentifierInput) => input)
  .handler(async ({ data }): Promise<string | null> => {
    // Static imports cannot work here: this module is reachable from the client
    // bundle (routes import `resolveIdentifierParam`), and the Start import
    // protection rejects a static edge to server-only modules.
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    const context = await getCurrentContext(getRequestHeaders())
    if (!context?.workspace) return null
    const { resolveIdentifier } =
      await import('#/lib/identifier-resolution.server')
    return resolveIdentifier({
      entity: data.entity,
      identifier: data.identifier,
      workspaceId: context.workspace.id,
      userId: context.user.id,
    })
  })

/** Rewrite the display id in a path with its canonical UUID, keeping the rest
 * of the path (child tabs), the query and the hash. */
export function canonicaliseIdentifierPath(
  href: string,
  from: string,
  to: string,
): string {
  const url = new URL(href, 'http://sheetbase.local')
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  url.pathname = url.pathname.replace(
    new RegExp(`/${escaped}(?=/|$)`),
    `/${to}`,
  )
  return `${url.pathname}${url.search}${url.hash}`
}

type ResolveIdentifier = (
  input: ResolveIdentifierInput,
) => Promise<string | null>

const defaultResolve: ResolveIdentifier = (input) =>
  resolveIdentifierFn({ data: input })

/**
 * Route `beforeLoad` helper: a UUID param passes through; a display-id param is
 * resolved and, when it maps to a row in the caller's workspace, redirected to
 * the canonical UUID URL. An unresolved identifier is left alone so the route's
 * own not-found state renders instead of an error page.
 */
export async function resolveIdentifierParam(
  input: { entity: IdentifierEntity; ref: string; href: string },
  resolve: ResolveIdentifier = defaultResolve,
): Promise<void> {
  if (isUuid(input.ref)) return
  const id = await resolve({ entity: input.entity, identifier: input.ref })
  if (!id || id === input.ref) return
  throw redirect({
    href: canonicaliseIdentifierPath(input.href, input.ref, id),
    replace: true,
  })
}
