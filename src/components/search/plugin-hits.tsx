import { useMemo } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { SearchResultIcon } from '#/components/search/result-icon'
import { ObjectLink } from '#/components/ui/object-link'
import { t } from '#/copy'
import type { PluginSearchHit } from '#/lib/extensions/plugin-search.server'
import { searchResultGroup, searchResultGroupLabel } from '#/lib/search'
import type { SearchResultType } from '#/lib/search'

const keyOf = (hit: PluginSearchHit) => `${hit.type}-${hit.id}`

/** What plugins found, in the app's one table. Names link like every list. */
export function PluginHitsTable({
  hits,
  label,
}: {
  hits: PluginSearchHit[]
  label: string
}) {
  const navigate = useNavigate()
  const columns = useMemo<RegistryColumn<PluginSearchHit>[]>(
    () => [
      {
        id: 'title',
        header: t('plugins.search.columns.name'),
        cell: ({ row }) => (
          <span className="inline-flex max-w-full items-center gap-1.5">
            <SearchResultIcon
              result={{
                resultType: row.original.type as SearchResultType,
                kind: row.original.kind,
                matchedField: 'description',
              }}
            />
            <ObjectLink
              kind={
                row.original.type === 'record'
                  ? row.original.kind
                  : row.original.type
              }
              id={row.original.id}
              identifier={row.original.identifier}
              className="shrink-0 text-fg-muted"
            />
            <Link
              to={row.original.deepLink}
              className="truncate text-fg hover:text-link"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.title}
            </Link>
          </span>
        ),
      },
      {
        id: 'type',
        header: t('plugins.search.columns.type'),
        meta: {
          headerClassName: 'max-lg:hidden',
          cellClassName: 'max-lg:hidden',
        },
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {searchResultGroupLabel(
              searchResultGroup({
                resultType: row.original.type as SearchResultType,
                kind: row.original.kind,
                matchedField: 'description',
              }),
            )}
          </span>
        ),
      },
      {
        id: 'why',
        header: t('plugins.search.columns.why'),
        meta: {
          headerClassName: 'max-md:hidden',
          cellClassName: 'max-md:hidden',
        },
        cell: ({ row }) => (
          <span
            className="block max-w-[420px] truncate text-fg-muted"
            title={row.original.snippet}
          >
            {row.original.snippet || '—'}
          </span>
        ),
      },
      {
        id: 'from',
        header: t('plugins.search.columns.from'),
        cell: ({ row }) => (
          <span className="text-fg-muted" title={row.original.pluginName}>
            {row.original.providerTitle}
          </span>
        ),
      },
    ],
    [],
  )
  return (
    <RegistryGrid
      label={label}
      rows={hits}
      columns={columns}
      getRowId={keyOf}
      selectable={false}
      onRowClick={(hit) => void navigate({ href: hit.deepLink })}
      isLoading={false}
    />
  )
}
