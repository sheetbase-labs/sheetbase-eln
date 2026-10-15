import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { DataClientError } from '#/lib/data-client'
import { cn } from '#/lib/utils'
import { MobileList, stickyFirstCell, stickyFirstHead } from './mobile-list'
import type { MobileRow } from './mobile-list'
import type { IconName } from '#/components/v3/icons'

/** A project tab that lists one kind of its own records (R5-SURF-02). Same
 * table pattern as the project Overview sections; phones get stacked rows.
 * The read is already project-scoped at the boundary, so this component only
 * renders — it never filters. */
export type ProjectListCol<T> = {
  key: string
  label: React.ReactNode
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
  title: React.ReactNode
  count?: React.ReactNode
  action?: React.ReactNode
  cols: ProjectListCol<T>[]
  rows: T[]
  mobile: MobileRow[]
  empty: { icon?: IconName; title: string; body: string }
  footer?: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto px-4 py-[22px] md:px-8">
      <Section title={title} count={count} action={action}>
        {rows.length ? (
          <>
            <MobileList
              className="-mx-4 border-t border-border md:hidden"
              label={String(title)}
              rows={mobile}
            />
            <TableBox className="max-md:hidden">
              <Table aria-label={String(title)}>
                <TableHeader>
                  <TableRow>
                    {cols.map((c) => (
                      <TableHead
                        key={c.key}
                        align={c.align}
                        className={stickyFirstHead}
                      >
                        {c.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.key}>
                      {cols.map((c) => (
                        <TableCell
                          key={c.key}
                          align={c.align}
                          className={cn(stickyFirstCell, c.className)}
                        >
                          {c.cell(r)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          </>
        ) : (
          <EmptyState
            className="py-2"
            icon={empty.icon}
            title={empty.title}
            body={empty.body}
          />
        )}
      </Section>
      {footer ? <p className="m-0 text-label text-fg-muted">{footer}</p> : null}
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
      <Notice tone="info" title="That page is past the end of this list.">
        This project has {total} {label}.{' '}
        <Link {...link} className="text-link">
          Back to the first page
        </Link>
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
        title={`You do not have access to ${what}.`}
      >
        Ask a project editor to add you to this project, or open a project you
        already belong to.
      </Notice>
    )
  }
  return (
    <Notice
      tone="bad"
      title={`Could not load ${what}.`}
      action={
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      The read failed. Nothing has been hidden or replaced with sample data.
    </Notice>
  )
}
