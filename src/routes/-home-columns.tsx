/**
 * Home's two tables: submissions awaiting this reader's review and the person's
 * own recently viewed work.
 */
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Person } from '#/components/ui/person'
import { Status } from '#/components/ui/status'
import { rightAligned } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { describeRecentChange, recentStatusLabel } from '#/lib/recents'
import type { RecentItem } from '#/lib/recents'
import { formatRelativeTime } from '#/lib/notebook-data'
import { recentTone } from '#/components/home/home-quiet'
import { homeDueLabel } from '#/lib/home-data'
import { now as appNow } from '#/lib/clock'
import { t } from '#/copy'

/** The registry's click rule for a row (see `useOpenRow`). */
export type OpenRow<T> = (row: T, event?: React.MouseEvent) => void

/** A submission awaiting this reader's review, as `fetchHomeReviews` returns
 * it. */
export interface HomeReviewRow {
  id: string
  revisionId: string
  identifier: string
  title: string
  projectTitle: string | null
  submittedByName: string | null
  submittedByUserId?: string | null
  dueAt: string | null
}

/**
 * A phone has room for the record and the way into it, not for every column:
 * the rest stay in the table from tablet width up.
 */
const PHONE_HIDDEN = {
  headerClassName: 'max-md:hidden',
  cellClassName: 'max-md:hidden',
}

/** Awaiting your review, which names the record, its project, who submitted it
 * and its due date, with the way into the review. */
export function homeReviewColumns(
  timeZone: string,
  open: OpenRow<HomeReviewRow>,
): RegistryColumn<HomeReviewRow>[] {
  return [
    {
      id: 'identifier',
      header: t('projects.home.columns.id'),
      cell: ({ row }) => (
        <Link
          to="/review/$revisionId"
          params={{ revisionId: row.original.revisionId }}
          className="mono text-link"
          onClick={(event) => open(row.original, event)}
        >
          {row.original.identifier}
        </Link>
      ),
    },
    {
      id: 'record',
      header: t('projects.home.columns.record'),
      cell: ({ row }) => (
        <Link
          to="/review/$revisionId"
          params={{ revisionId: row.original.revisionId }}
          className="text-fg hover:text-link"
          onClick={(event) => open(row.original, event)}
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      id: 'project',
      header: t('projects.home.columns.project'),
      meta: PHONE_HIDDEN,
      cell: ({ row }) => row.original.projectTitle ?? '—',
    },
    {
      id: 'submittedBy',
      header: t('projects.home.columns.submittedBy'),
      meta: PHONE_HIDDEN,
      cell: ({ row }) =>
        row.original.submittedByName ? (
          <Person
            name={row.original.submittedByName}
            userId={row.original.submittedByUserId}
          />
        ) : (
          '—'
        ),
    },
    {
      id: 'due',
      header: t('projects.home.columns.due'),
      meta: { ...PHONE_HIDDEN, cellClassName: 'num max-md:hidden' },
      cell: ({ row }) => homeDueLabel(row.original.dueAt, appNow(), timeZone),
    },
    {
      id: 'action',
      header: () => (
        <span className="sr-only">{t('projects.home.columns.action')}</span>
      ),
      meta: rightAligned<HomeReviewRow>().meta,
      cell: ({ row }) => (
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link
              to="/review/$revisionId"
              params={{ revisionId: row.original.revisionId }}
              onClick={(event: React.MouseEvent) => open(row.original, event)}
            />
          }
        >
          {t('projects.home.columns.review')}
        </Button>
      ),
    },
  ]
}

/** The person's own recent work, which names the record, its status, what last
 * changed and when. */
export const homeRecentColumns = (
  open: OpenRow<RecentItem>,
): RegistryColumn<RecentItem>[] => [
  {
    id: 'identifier',
    header: t('projects.home.columns.id'),
    cell: ({ row }) =>
      row.original.identifier ? (
        <Link
          to={row.original.destination}
          className="mono text-link"
          onClick={(event) => open(row.original, event)}
        >
          {row.original.identifier}
        </Link>
      ) : (
        <span className="text-fg-muted">—</span>
      ),
  },
  {
    id: 'name',
    header: t('projects.home.columns.name'),
    cell: ({ row }) => (
      <Link
        to={row.original.destination}
        className="text-fg hover:text-link"
        onClick={(event) => open(row.original, event)}
      >
        {row.original.label}
      </Link>
    ),
  },
  {
    id: 'status',
    header: t('projects.home.columns.status'),
    meta: PHONE_HIDDEN,
    cell: ({ row }) => {
      const status = recentStatusLabel(row.original)

      return status ? (
        <Status tone={recentTone(row.original)}>{status}</Status>
      ) : (
        <span className="text-fg-muted">—</span>
      )
    },
  },
  {
    id: 'change',
    header: t('projects.home.columns.lastActivity'),
    meta: { ...PHONE_HIDDEN, cellClassName: 'text-fg-muted max-md:hidden' },
    cell: ({ row }) => describeRecentChange(row.original),
  },
  {
    id: 'updated',
    header: t('projects.home.columns.updated'),
    meta: {
      headerClassName: 'text-right max-md:hidden',
      cellClassName: 'num text-right text-fg-muted max-md:hidden',
    },
    cell: ({ row }) => formatRelativeTime(row.original.lastActivityAt),
  },
]
