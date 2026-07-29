import * as React from 'react'

import { cn } from '#/lib/utils'

interface PropertyListProps {
  children: React.ReactNode
  className?: string
}

interface PropertyProps {
  label: string
  children: React.ReactNode
}

function PropertyList({ children, className }: PropertyListProps) {
  return (
    <dl
      className={cn(
        'grid divide-y divide-border text-sm [&>*]:py-2 [&>*]:first:pt-0 [&>*]:last:pb-0',
        className,
      )}
    >
      {children}
    </dl>
  )
}

function Property({ label, children }: PropertyProps) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-baseline gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-foreground">{children}</dd>
    </div>
  )
}

export { Property, PropertyList, type PropertyListProps }
