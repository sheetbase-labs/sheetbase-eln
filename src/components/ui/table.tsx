import * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * Semantic table primitives. Data-dense tables should add `tabular-nums`
 * (Tailwind utility) or `.scientific-nums` on numeric columns so digits
 * align. Row selection state is signalled with `data-[state=selected]`.
 */
function Table({
  className,
  containerClassName,
  variant = 'default',
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & {
  containerClassName?: string
  /** Quiet headings and dividers for work lists with secondary record metadata. */
  variant?: 'default' | 'quiet'
}) {
  return (
    <div className={cn('relative w-full overflow-auto', containerClassName)}>
      <table
        data-slot="table"
        data-variant={variant}
        className={cn(
          'w-full caption-bottom text-sm',
          variant === 'quiet' &&
            '[&_th]:h-8 [&_th]:font-medium [&_th]:normal-case [&_th]:tracking-normal [&_td]:py-2.5 [&_tr]:border-border/40',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b bg-control [&_tr:hover]:bg-transparent', className)}
      {...props}
    />
  )
}

function TableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  )
}

function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-active',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-8 px-3 text-left align-middle text-[11px] font-label leading-[14px] text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-3 py-3 align-middle', className)}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
}
