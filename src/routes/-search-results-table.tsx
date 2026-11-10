import { useMemo } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { SearchResultIcon } from '#/components/search/result-icon'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { MobileList, stickyCol } from '#/components/projects/mobile-list'
import { sampleStatus } from '#/components/samples/samples-data'
import { Highlight } from '#/components/search/highlight'
import {
  searchResultContext,
  searchResultLabel,
  searchResultParentLine,
} from '#/components/search/result-text'
import { formatListDate } from '#/lib/list-date'
import { now } from '#/lib/clock'
import type { SearchResult } from '#/lib/search'
import { t } from '#/copy'

function statusTone(status: string): Tone {
  switch (status) {
    case 'approved':
      return 'ok'
    case 'in_review':
      return 'review'
    case 'in_progress':
      return 'progress'
    case 'archived':
      return 'stored'
    default:
      return 'none'
  }
}

function statusLabel(status: string, kind?: string): string {
  if (kind === 'sample') return sampleStatus(status).label

  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** One line of matched text, with the match marked. */
function MatchText({ result }: { result: SearchResult }) {
  const context = searchResultContext(result, result.matchedContext)
  const parentLine = searchResultParentLine(result)

  if (!context.length && !parentLine) return null

  return (
    <span className="block max-w-[300px] truncate text-fg-muted">
      {parentLine ? <span>{parentLine} · </span> : null}
      {context.map((segment, i) =>
        segment.highlighted ? (
          <mark key={i} className="rounded-[2px] bg-highlight px-px text-fg">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </span>
  )
}

const resultKey = (r: SearchResult) => `${r.resultType}-${r.recordId}`

/**
 * The results as the same table every list uses: one row per match, best
 * match first. The Type facet already splits records, notebook text and files.
 */
export function SearchResultsTable({
  results,
  q,
  projectNames,
  isLoading,
}: {
  results: SearchResult[]
  q: string
  projectNames: ReadonlyMap<string, string> | undefined
  isLoading: boolean
}) {
  const navigate = useNavigate()
  const open = (r: SearchResult) => void navigate({ href: r.deepLink })

  const columns = useMemo<RegistryColumn<SearchResult>[]>(
    () => [
      {
        id: 'identifier',
        header: t('projects.searchPage.columns.id'),
        meta: {
          headerClassName: 'max-xl:hidden',
          cellClassName: 'max-xl:hidden',
        },
        cell: ({ row }) => (
          <span className="mono whitespace-nowrap">
            {searchResultLabel(row.original) ?? '—'}
          </span>
        ),
      },
      {
        id: 'title',
        header: t('projects.searchPage.columns.name'),
        meta: {
          headerClassName: stickyCol,
          cellClassName: `${stickyCol} max-xl:h-auto max-xl:py-1`,
        },
        cell: ({ row }) => (
          <>
            <Link
              to={row.original.deepLink}
              className="inline-flex max-w-full items-center gap-1.5 text-fg hover:text-link"
              onClick={(event) => event.stopPropagation()}
            >
              <SearchResultIcon result={row.original} />
              <span className="truncate">
                <Highlight text={row.original.title} q={q} />
              </span>
            </Link>
            <span className="mono block text-[11px] text-fg-muted xl:hidden">
              {searchResultLabel(row.original)}
            </span>
          </>
        ),
      },
      {
        id: 'match',
        header: t('projects.searchPage.columns.match'),
        meta: {
          headerClassName: 'max-lg:hidden',
          cellClassName: 'max-lg:hidden',
        },
        cell: ({ row }) => <MatchText result={row.original} />,
      },
      {
        id: 'project',
        header: t('projects.searchPage.columns.project'),
        // The Project facet beside the table already names each project.
        meta: {
          headerClassName: 'max-2xl:hidden',
          cellClassName: 'max-2xl:hidden',
        },
        cell: ({ row }) =>
          row.original.projectId ? (
            <Link
              to="/projects/$projectId"
              params={{ projectId: row.original.projectId }}
              className="text-fg hover:text-link"
              onClick={(event) => event.stopPropagation()}
            >
              {projectNames?.get(row.original.projectId) ?? '—'}
            </Link>
          ) : (
            <span className="text-fg-muted">—</span>
          ),
      },
      {
        id: 'status',
        header: t('projects.searchPage.columns.status'),
        cell: ({ row }) =>
          row.original.status ? (
            <Status tone={statusTone(row.original.status)}>
              {statusLabel(row.original.status, row.original.kind)}
            </Status>
          ) : (
            <span className="text-fg-muted">—</span>
          ),
      },
      {
        id: 'updated',
        header: t('projects.searchPage.columns.updated'),
        meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatListDate(row.original.updatedAt, now())}
          </span>
        ),
      },
    ],
    [q, projectNames],
  )

  return (
    <>
      <MobileList
        className="md:hidden"
        label={t('projects.searchPage.resultsLabel')}
        rows={results.map((r) => ({
          key: resultKey(r),
          title: r.title,
          meta: <MatchText result={r} />,
          status: r.status
            ? {
                tone: statusTone(r.status),
                label: statusLabel(r.status, r.kind),
              }
            : undefined,
          onClick: () => open(r),
        }))}
      />
      <RegistryGrid
        className="max-md:hidden"
        label={t('projects.searchPage.resultsLabel')}
        rows={results}
        columns={columns}
        getRowId={resultKey}
        selectable={false}
        onRowClick={open}
        isLoading={isLoading}
      />
    </>
  )
}
