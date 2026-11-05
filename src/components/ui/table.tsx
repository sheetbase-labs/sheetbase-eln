import { Children } from 'react'

import { cn } from '#/lib/utils'
import { Skeleton } from './skeleton'

// Record table (.t): 32px rows, 12px muted headers on surface-muted, tabular numerals.
export function Table({
  className,
  caption,
  children,
  ...props
}: React.ComponentProps<'table'> & {
  /** Accessible name for the table, rendered as the native caption. */
  caption?: React.ReactNode
}) {
  return (
    <table
      data-slot="table"
      className={cn('num w-full border-collapse text-body', className)}
      {...props}
    >
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      {children}
    </table>
  )
}
export function TableBox({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-md border border-border',
        className,
      )}
      {...props}
    />
  )
}
export const TableHeader = (p: React.ComponentProps<'thead'>) => (
  <thead {...p} />
)
/**
 * The body either holds rows or states why it holds none: `loading` shows a
 * skeleton row, `empty` the message a caller gives. Call sites that pass
 * neither keep rendering their children untouched.
 */
export function TableBody({
  children,
  loading = false,
  empty,
  colSpan,
  ...props
}: React.ComponentProps<'tbody'> & {
  loading?: boolean
  empty?: React.ReactNode
  /** Columns the loading or empty row spans. */
  colSpan?: number
}) {
  const hasRows = Children.count(children) > 0
  return (
    <tbody {...props}>
      {loading ? (
        <TableStateRow colSpan={colSpan}>
          <Skeleton className="h-3.5 w-40" />
        </TableStateRow>
      ) : hasRows || empty === undefined ? (
        children
      ) : (
        <TableStateRow colSpan={colSpan}>{empty}</TableStateRow>
      )}
    </tbody>
  )
}

/** The one-row body state a table without records renders. */
export function TableStateRow({
  colSpan,
  children,
}: {
  colSpan?: number
  children: React.ReactNode
}) {
  return (
    <tr data-slot="table-state-row">
      <td
        colSpan={colSpan}
        className="h-[44px] px-2.5 text-label text-fg-muted first:pl-6"
      >
        {children}
      </td>
    </tr>
  )
}
export function TableRow({
  className,
  selected,
  ...props
}: React.ComponentProps<'tr'> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn('group/row', className)}
      {...props}
    />
  )
}
export function TableHead({
  className,
  align,
  ...props
}: React.ComponentProps<'th'> & { align?: 'right' }) {
  return (
    <th
      className={cn(
        'h-[31px] whitespace-nowrap border-b border-border bg-surface-muted px-2.5 text-left text-label font-medium text-fg-muted first:pl-6 max-md:first:pl-3',
        align === 'right' && 'text-right',
        className,
      )}
      {...props}
    />
  )
}
export function TableCell({
  className,
  align,
  ...props
}: React.ComponentProps<'td'> & { align?: 'right' }) {
  return (
    <td
      className={cn(
        'h-[33px] whitespace-nowrap border-b border-border-subtle px-2.5 first:pl-6 max-md:first:pl-3 group-hover/row:bg-row-hover group-aria-selected/row:bg-selection',
        align === 'right' && 'text-right',
        className,
      )}
      {...props}
    />
  )
}
