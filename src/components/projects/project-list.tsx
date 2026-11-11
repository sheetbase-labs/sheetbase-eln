import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { rich, t } from '#/copy'
import { EmptyState } from '#/components/ui/empty-state'
import { Notice } from '#/components/ui/alert'
import { Section } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { DataClientError } from '#/lib/data-client'
import { cn } from '#/lib/utils'
import { MobileList } from './mobile-list'
import type { MobileRow } from './mobile-list'
import type { IconName } from '#/components/icons'

/** A project tab that lists one kind of its own records (R5-SURF-02). Same
 * table pattern as the project Overview sections; phones get stacked rows.
 * The read is already project-scoped at the boundary, so this component only
 * renders — it never filters. */
export type ProjectListCol<T> = {
  key: string
  label: string
  /** A column of buttons has a name for assistive tech but shows no heading. */
  hideLabel?: boolean
  align?: 'right'
  cell: (row: T) => React.ReactNode
  className?: string
}

export function ProjectList<T extends { key: string }>({
  title,
  count,
  action,
  cols,
  rows,
  mobile,
  empty,
  footer,
}: {
  /** The list's heading; also the table and phone-list accessible name. */
  title: string
  count?: React.ReactNode
  action?: React.ReactNode
  cols: ProjectListCol<T>[]
  rows: T[]
  mobile: MobileRow[]
  /** What to show with no rows, and the one next action that fills them. */
  empty: {
    icon?: IconName
    title: string
    body: string
    action?: React.ReactNode
  }
  footer?: React.ReactNode
}) {
  const columns: RegistryColumn<T>[] = cols.map((c) => ({
    id: c.key,
    header: c.hideLabel
      ? () => <span className="sr-only">{c.label}</span>
      : c.label,
    enableHiding: !c.hideLabel,
    cell: ({ row }) => c.cell(row.original),
    meta: {
      headerClassName: c.align === 'right' ? 'text-right' : undefined,
      cellClassName: cn(c.align === 'right' && 'text-right', c.className),
    },
  }))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto px-4 py-[22px] md:px-8">
      <Section title={title} count={count} action={action}>
        {rows.length ? (
          <>
            <MobileList
              className="-mx-4 border-t border-border md:hidden"
              label={title}
              rows={mobile}
            />
            <TableBox className="max-md:hidden">
              <RegistryGrid
                label={title}
                rows={rows}
                columns={columns}
                getRowId={(r) => r.key}
                selectable={false}
              />
            </TableBox>
          </>
        ) : (
          <EmptyState
            className="py-2"
            icon={empty.icon}
            title={empty.title}
            description={empty.body}
            action={empty.action}
          />
        )}
      </Section>
      {footer ? <div className="text-label text-fg-muted">{footer}</div> : null}
    </div>
  )
}

/**
 * The honest state for a page past the end of a project list: a hand-edited
 * `?page=` must not read as "this project has no rows". The link returns to the
 * first page.
 */
export function ProjectListOutOfRange({
  total,
  label,
  link,
}: {
  total: number
  label: string
  link: LinkProps
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-[22px] md:px-8">
      <Notice tone="info" title={t('projects.projectList.pastEnd.title')}>
        {rich('projects.projectList.pastEnd.body', {
          total,
          label,
          link: (text) => (
            <Link {...link} className="text-link">
              {text}
            </Link>
          ),
        })}
      </Notice>
    </div>
  )
}

/**
 * The honest state for a project tab whose read failed. A refused read (RLS or
 * the proxy's denial envelope) says so rather than rendering an empty list that
 * would read as "this project has no rows"; any other failure offers a retry
 * and never substitutes sample data.
 */
export function ProjectListFailure({
  error,
  onRetry,
  what,
}: {
  error: unknown
  onRetry: () => void
  what: string
}) {
  const denied =
    error instanceof DataClientError &&
    (error.code === 'permission_denied' ||
      error.status === 401 ||
      error.status === 403)

  if (denied) {
    return (
      <Notice
        tone="info"
        icon="lock"
        title={t('projects.projectList.denied.title', { what })}
      >
        {t('projects.projectList.denied.body')}
      </Notice>
    )
  }

  return (
    <Notice
      tone="bad"
      title={t('projects.projectList.failed.title', { what })}
      action={
        <Button size="sm" onClick={onRetry}>
          {t('common.actions.tryAgain')}
        </Button>
      }
    >
      {t('projects.projectList.failed.body')}
    </Notice>
  )
}
