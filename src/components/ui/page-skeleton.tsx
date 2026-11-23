import { Section } from '#/components/ui/layout'
import { Skeleton } from '#/components/ui/skeleton'
import { cn } from '#/lib/utils'

/**
 * What a page shows while its first read is outstanding. Each piece takes the
 * geometry of the thing it stands in for (page padding, section heading, the
 * 31px header band and 33px rows of a table), so nothing moves when the data
 * lands. Pages compose these rather than drawing their own grey boxes.
 */

const CELL_WIDTHS = ['w-16', 'w-48', 'w-28', 'w-36', 'w-20', 'w-24']

/** A page or record title still being read: the heading's height, with the
 * words for a screen reader. */
export function TitleSkeleton({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <span role="status" className="flex items-center">
      <span className="sr-only">{label}</span>
      <Skeleton className={cn('h-6 w-48', className)} />
    </span>
  )
}

/** The columns and rows of a list that has not arrived: a header band and
 * single-line rows at the table's own height. */
export function TableSkeleton({
  columns = 5,
  rows = 6,
  className,
}: {
  columns?: number
  rows?: number
  className?: string
}) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col', className)}>
      <div className="flex h-[31px] items-center gap-6 bg-surface-muted px-6">
        {Array.from({ length: columns }).map((_, c) => (
          <Skeleton key={c} className={cn('h-2.5', CELL_WIDTHS[c % 6])} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex h-[33px] items-center gap-6 border-b border-border-subtle px-6"
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn('h-3', CELL_WIDTHS[(c + r) % 6])} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** A titled section whose body is a table that has not arrived. */
export function SectionSkeleton({
  title,
  columns,
  rows,
}: {
  title: React.ReactNode
  columns?: number
  rows?: number
}) {
  return (
    <Section title={title}>
      <TableSkeleton columns={columns} rows={rows} className="-mx-4 md:-mx-6" />
    </Section>
  )
}

/** A row of chips (status counts, filters) before its numbers are known. */
export function ChipRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-28" />
      ))}
    </div>
  )
}

/** The body of a record or detail page: a tab strip and a few blocks. */
export function RecordBodySkeleton({ blocks = 3 }: { blocks?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-4 py-4 md:px-6">
      <div className="flex gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-16" />
        ))}
      </div>
      {Array.from({ length: blocks }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4"
        >
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}
