import { useMemo } from 'react'
import { ObjectLink } from '#/components/ui/object-link'
import { Link, useNavigate } from '@tanstack/react-router'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { SearchResultIcon } from '#/components/search/result-icon'
import { Status } from '#/components/ui/status'
import type { SemanticHit } from '#/lib/ai-embeddings'
import { searchResultGroup, searchResultGroupLabel } from '#/lib/search'
import { t } from '#/copy'
import { closenessLabel, closenessTone } from './closeness'

const keyOf = (hit: SemanticHit) => `${hit.type}-${hit.id}`

/**
 * Hits found by meaning, in the app's one table: the object, what kind it is,
 * the passage that made it come up and how close it is. Names link to the
 * object like every other list.
 */
export function SemanticHitsTable({
  hits,
  label,
}: {
  hits: SemanticHit[]
  label: string
}) {
  const navigate = useNavigate()

  const columns = useMemo<RegistryColumn<SemanticHit>[]>(
    () => [
      {
        id: 'title',
        header: t('projects.searchMeaning.columns.name'),
        cell: ({ row }) => (
          <span className="inline-flex max-w-full items-center gap-1.5">
            <SearchResultIcon
              result={{
                resultType: row.original.type,
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
        header: t('projects.searchMeaning.columns.type'),
        meta: {
          headerClassName: 'max-lg:hidden',
          cellClassName: 'max-lg:hidden',
        },
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {searchResultGroupLabel(
              searchResultGroup({
                resultType: row.original.type,
                kind: row.original.kind,
                matchedField: 'description',
              }),
            )}
          </span>
        ),
      },
      {
        id: 'why',
        header: t('projects.searchMeaning.columns.why'),
        meta: {
          headerClassName: 'max-md:hidden',
          cellClassName: 'max-md:hidden',
        },
        cell: ({ row }) => (
          <span
            className="block max-w-[420px] truncate text-fg-muted"
            title={row.original.passage}
          >
            {row.original.passage}
          </span>
        ),
      },
      {
        id: 'closeness',
        header: t('projects.searchMeaning.columns.closeness'),
        cell: ({ row }) => (
          <Status tone={closenessTone(row.original.similarity)}>
            {closenessLabel(row.original.similarity)}
          </Status>
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
