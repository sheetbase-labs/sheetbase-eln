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
  return <dl className={cn('grid gap-3 text-sm', className)}>{children}</dl>
}

function Property({ label, children }: PropertyProps) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-xs font-medium text-foreground">
        {children}
      </dd>
    </div>
  )
}

export { Property, PropertyList, type PropertyListProps }
