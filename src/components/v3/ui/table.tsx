import { cn } from '#/lib/utils'

// Record table (.t): 32px rows, 12px muted headers on surface-muted, tabular numerals.
export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <table
      data-slot="table"
      className={cn('num w-full border-collapse text-body', className)}
      {...props}
    />
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
export const TableBody = (p: React.ComponentProps<'tbody'>) => <tbody {...p} />
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
        'h-[31px] whitespace-nowrap border-b border-border bg-surface-muted px-2.5 text-left text-label font-medium text-fg-muted first:pl-6',
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
        'h-[33px] whitespace-nowrap border-b border-border-subtle px-2.5 first:pl-6 group-hover/row:bg-row-hover group-aria-selected/row:bg-selection',
        align === 'right' && 'text-right',
        className,
      )}
      {...props}
    />
  )
}
