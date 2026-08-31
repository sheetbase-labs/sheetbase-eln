/**
 * FIND-02 — Favourites & saved context data layer.
 *
 * Favourites are the deliberate counterpart to FIND-01 recents: a pin the
 * user explicitly placed on a canonical object, persisted per user in the
 * thin `api.user_favourites` table (FIND-02 migration). Writes go exclusively
 * through the `set_record_favourite` SECURITY DEFINER RPC, which resolves the
 * object's workspace from its canonical table and verifies workspace
 * membership; reads flow back through the same /api/db PostgREST boundary
 * under RLS.
 *
 * Favourites never own or duplicate the scientific object: a favourite is
 * just a (kind, uuid) pair plus a timestamp. Objects that are later
 * archived/retired/deleted stay favourited in storage but are dropped at
 * read time (below), so a favourite never links somewhere the user cannot
 * go; unfavouriting is the only removal.
 *
 * Ordering is deterministic: created_at desc (most recently favourited
 * first), ties broken by kind then id, capped. Labels and destinations come
 * exclusively from the canonical tables and `src/lib/navigation.ts` — never
 * hand-built URLs.
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'
import type { ProjectWire } from './notebook-data'
import {
  datasetPath,
  notebookTemplatePath,
  projectPath,
  recordDestination,
  sheetPath,
} from './navigation'
import type { RecentObjectKind } from './recents'

// ---------------------------------------------------------------------------
// Domain shapes.
// ---------------------------------------------------------------------------

/** Canonical object kinds that can be favourited — the recents vocabulary. */
export type FavouriteObjectKind = RecentObjectKind

/** Wire shape of `api.user_favourites` (snake_case via PostgREST). */
export interface FavouriteWire {
  user_id: string
  object_kind: FavouriteObjectKind
  object_id: string
  created_at: string
}

/** A resolved favourite: stable (kind, id) identity plus favourited-at. */
export interface Favourite {
  kind: FavouriteObjectKind
  id: string
  createdAt: string
}

/** A resolved favourite ready to render. */
export interface FavouriteItem {
  kind: FavouriteObjectKind
  id: string
  label: string
  /** Secondary identity line (identifier/key) when the object has one. */
  identifier: string | null
  destination: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Query keys.
// ---------------------------------------------------------------------------

export const favouritesQueryKeys = {
  /** Raw per-user favourite rows (RLS-scoped), as stored. */
  list: () => ['favourites', 'list'] as const,
  /** Resolved favourite items for the home surface. */
  items: () => ['favourites', 'items'] as const,
}

/** How many resolved favourites the compact home surface shows. */
export const FAVOURITES_LIMIT = 12

/** Fetch window for the raw rows; tiebreak/cap happens client-side. */
const FAVOURITES_FETCH_LIMIT = 200

// ---------------------------------------------------------------------------
// Ordering & toggle semantics (pure).
// ---------------------------------------------------------------------------

/**
 * Deterministic favourite ordering: created_at desc, then kind asc, then id
 * asc (stable across fetches), capped to `limit`.
 */
export function orderFavourites(
  favourites: Favourite[],
  limit = FAVOURITES_FETCH_LIMIT,
): Favourite[] {
  const sorted = [...favourites].sort((a, b) => {
    const diff = Date.parse(b.createdAt) - Date.parse(a.createdAt)
    if (diff !== 0) return diff
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
  return sorted.slice(0, limit)
}

/**
 * Pure toggle semantics used for optimistic cache updates: adds one
 * (kind, id) pin or removes it. Idempotent — toggling to the same state is a
 * no-op, and a favourite that already exists keeps its original created_at.
 */
export function applyFavouriteChange(
  favourites: Favourite[],
  kind: FavouriteObjectKind,
  objectId: string,
  favourite: boolean,
): Favourite[] {
  const without = favourites.filter(
    (f) => !(f.kind === kind && f.id === objectId),
  )
  if (!favourite) return without
  const existing = favourites.find((f) => f.kind === kind && f.id === objectId)
  return [
    {
      kind,
      id: objectId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    },
    ...without,
  ]
}

// ---------------------------------------------------------------------------
// Fetch helpers — through the same /api/db PostgREST boundary as the rest of
// the app, so every read respects the same RLS boundaries.
// ---------------------------------------------------------------------------

export function toFavourite(row: FavouriteWire): Favourite {
  return {
    kind: row.object_kind,
    id: row.object_id,
    createdAt: row.created_at,
  }
}

/**
 * Per-user favourite rows. RLS restricts to the current user; unknown or
 * no-longer-resolvable objects are handled by resolution, never here.
 */
export function fetchFavourites(
  client: DataClient = notebookDataClient,
): Promise<Favourite[]> {
  return client
    .list<FavouriteWire>(
      'user_favourites',
      `?order=created_at.desc&limit=${FAVOURITES_FETCH_LIMIT}&select=user_id,object_kind,object_id,created_at`,
    )
    .then((rows) => orderFavourites(rows.map(toFavourite)))
}

/**
 * Favourite or unfavourite a canonical object. The RPC upserts or deletes one
 * row per (user, kind, object) and is a no-op returning null for objects the
 * caller can no longer see. PostgREST renders the scalar timestamptz return
 * as a bare JSON string.
 */
export function setFavourite(
  client: DataClient,
  kind: FavouriteObjectKind,
  objectId: string,
  favourite: boolean,
): Promise<string | null> {
  return client
    .rpc<string | { created_at?: string } | null>('set_record_favourite', {
      p_object_kind: kind,
      p_object_id: objectId,
      p_favourite: favourite,
    })
    .then((row) => {
      if (typeof row === 'string') return row
      return row?.created_at ?? null
    })
}

// ---------------------------------------------------------------------------
// Resolution — canonical labels and destinations.
// ---------------------------------------------------------------------------

interface RecordLabelWire {
  id: string
  kind: string
  identifier: string
  title: string
  archived_at: string | null
  deleted_at: string | null
}

interface DatasetLabelWire {
  id: string
  name: string
  lifecycle: string
}

interface SheetLabelWire {
  id: string
  name: string
  lifecycle: string
}

interface TemplateLabelWire {
  id: string
  key: string
  name: string
  lifecycle: string
}

/**
 * Resolves favourites to renderable items with canonical labels and
 * navigation destinations. Favourites whose canonical object is gone,
 * archived, retired or otherwise not openable are dropped — a favourite of a
 * since-archived object is hidden, NOT deleted (unfavouriting is the only
 * removal). Input order (the deterministic favourite order) is preserved.
 */
export async function resolveFavouriteItems(
  client: DataClient,
  favourites: Favourite[],
): Promise<FavouriteItem[]> {
  if (favourites.length === 0) return []

  const idsByKind = new Map<FavouriteObjectKind, string[]>()
  for (const favourite of favourites) {
    const ids = idsByKind.get(favourite.kind) ?? []
    ids.push(favourite.id)
    idsByKind.set(favourite.kind, ids)
  }

  const [recordRows, datasetRows, sheetRows, projectRows, templateRows] =
    await Promise.all([
      idsByKind.has('record')
        ? client.list<RecordLabelWire>(
            'records',
            `?id=in.(${idsByKind.get('record')!.join(',')})&select=id,kind,identifier,title,archived_at,deleted_at`,
          )
        : Promise.resolve([]),
      idsByKind.has('dataset')
        ? client.list<DatasetLabelWire>(
            'datasets',
            `?id=in.(${idsByKind.get('dataset')!.join(',')})&select=id,name,lifecycle`,
          )
        : Promise.resolve([]),
      idsByKind.has('sheet')
        ? client.list<SheetLabelWire>(
            'sheet_instances',
            `?id=in.(${idsByKind.get('sheet')!.join(',')})&select=id,name,lifecycle`,
          )
        : Promise.resolve([]),
      idsByKind.has('project')
        ? client.list<ProjectWire>(
            'projects',
            `?id=in.(${idsByKind.get('project')!.join(',')})&select=id,key,title,archived_at`,
          )
        : Promise.resolve([]),
      idsByKind.has('notebook_template')
        ? client.list<TemplateLabelWire>(
            'notebook_templates',
            `?id=in.(${idsByKind.get('notebook_template')!.join(',')})&select=id,key,name,lifecycle`,
          )
        : Promise.resolve([]),
    ])

  const recordById = new Map(
    recordRows.map((r) => [
      r.id,
      {
        kind: r.kind,
        identifier: r.identifier,
        title: r.title,
        openable: r.deleted_at === null && r.archived_at === null,
      },
    ]),
  )
  const datasetById = new Map(
    datasetRows.map((d) => [
      d.id,
      { name: d.name, openable: d.lifecycle === 'active' },
    ]),
  )
  const sheetById = new Map(
    sheetRows.map((s) => [
      s.id,
      { name: s.name, openable: s.lifecycle === 'active' },
    ]),
  )
  const templateById = new Map(
    templateRows.map((t) => [
      t.id,
      { key: t.key, name: t.name, openable: t.lifecycle === 'active' },
    ]),
  )
  const projectById = new Map(
    projectRows.map((p) => [
      p.id,
      { key: p.key, title: p.title, openable: p.archived_at === null },
    ]),
  )

  const resolved: FavouriteItem[] = []
  for (const favourite of favourites) {
    switch (favourite.kind) {
      case 'record': {
        const record = recordById.get(favourite.id)
        if (!record || !record.openable) break
        resolved.push({
          ...favourite,
          label: record.title,
          identifier: record.identifier,
          destination: recordDestination(record.kind, favourite.id),
        })
        break
      }
      case 'dataset': {
        const dataset = datasetById.get(favourite.id)
        if (!dataset || !dataset.openable) break
        resolved.push({
          ...favourite,
          label: dataset.name,
          identifier: null,
          destination: datasetPath(favourite.id),
        })
        break
      }
      case 'sheet': {
        const sheet = sheetById.get(favourite.id)
        if (!sheet || !sheet.openable) break
        resolved.push({
          ...favourite,
          label: sheet.name,
          identifier: null,
          destination: sheetPath(favourite.id),
        })
        break
      }
      case 'project': {
        const project = projectById.get(favourite.id)
        if (!project || !project.openable) break
        resolved.push({
          ...favourite,
          label: project.title,
          identifier: project.key,
          destination: projectPath(favourite.id),
        })
        break
      }
      case 'notebook_template': {
        const template = templateById.get(favourite.id)
        if (!template || !template.openable) break
        resolved.push({
          ...favourite,
          label: template.name,
          identifier: template.key,
          destination: notebookTemplatePath(favourite.id),
        })
        break
      }
    }
  }
  return resolved
}

/**
 * One-shot read for the home surface: fetch the user's favourite rows, order
 * deterministically, then resolve labels/destinations. Archived/deleted/
 * retired objects are dropped, so the visible count may be below the limit.
 */
export async function fetchFavouriteItems(
  client: DataClient,
  limit = FAVOURITES_LIMIT,
): Promise<FavouriteItem[]> {
  const favourites = await fetchFavourites(client)
  const capped = orderFavourites(favourites, limit)
  return resolveFavouriteItems(client, capped)
}

// ---------------------------------------------------------------------------
// Hooks — shared favourite state + toggle mutation.
// ---------------------------------------------------------------------------

/**
 * The current user's raw favourite rows. RLS scopes the read to the current
 * user, so one shared key serves every mounted star toggle on the page.
 * Read failures degrade to "not favourited": the toggle is
 * presentation-support state and must never disturb the object page.
 */
export function useFavouritesList(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: favouritesQueryKeys.list(),
    queryFn: () => fetchFavourites(client),
    staleTime: 30_000,
  })
}

/** Arguments for one favourite write. */
export interface SetFavouriteVariables {
  kind: FavouriteObjectKind
  objectId: string
  favourite: boolean
}

/**
 * Favourite/unfavourite mutation with optimistic cache updates and rollback
 * on error. The write goes through the `set_record_favourite` RPC; both the
 * raw list and the resolved home items are invalidated afterwards so the
 * home surface refetches canonical labels.
 */
export function useSetFavourite(
  client: DataClient = notebookDataClient,
): ReturnType<typeof useMutation<void, Error, SetFavouriteVariables>> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      kind,
      objectId,
      favourite,
    }: SetFavouriteVariables) => {
      await setFavourite(client, kind, objectId, favourite)
    },
    onMutate: async ({ kind, objectId, favourite }) => {
      const previous =
        queryClient.getQueryData<Favourite[]>(favouritesQueryKeys.list()) ?? []
      queryClient.setQueryData<Favourite[]>(
        favouritesQueryKeys.list(),
        orderFavourites(
          applyFavouriteChange(previous, kind, objectId, favourite),
        ),
      )
      if (!favourite) {
        // Hide the item from the home surface immediately; favouriting from
        // an object page adds no home item until the refetch resolves labels.
        queryClient.setQueryData<FavouriteItem[]>(
          favouritesQueryKeys.items(),
          (items) =>
            items?.filter(
              (item) => !(item.kind === kind && item.id === objectId),
            ),
        )
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      // Roll the optimistic state back; the surfaced error tells the user.
      if (context?.previous) {
        queryClient.setQueryData(favouritesQueryKeys.list(), context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: favouritesQueryKeys.list(),
      })
      void queryClient.invalidateQueries({
        queryKey: favouritesQueryKeys.items(),
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Toggle state hook.
// ---------------------------------------------------------------------------

/**
 * Per-object favourite state for the star toggle: whether the object is
 * favourited, the setter, and the surfaced error from the last failed write.
 */
export function useFavouriteState(
  kind: FavouriteObjectKind,
  objectId: string | null | undefined,
  client: DataClient = notebookDataClient,
): {
  isFavourite: boolean
  setFavourite: (favourite: boolean) => void
  pending: boolean
  error: unknown
} {
  const listQuery = useFavouritesList(client)
  const mutation = useSetFavourite(client)

  const isFavourite = useMemo(() => {
    if (!objectId) return false
    return (listQuery.data ?? []).some(
      (f) => f.kind === kind && f.id === objectId,
    )
  }, [listQuery.data, kind, objectId])

  return {
    isFavourite,
    setFavourite: (favourite: boolean) => {
      if (!objectId) return
      mutation.mutate({ kind, objectId, favourite })
    },
    pending: mutation.isPending,
    error: mutation.error,
  }
}
