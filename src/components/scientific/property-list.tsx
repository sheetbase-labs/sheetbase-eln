import * as React from 'react'

import { cn } from '#/lib/utils'

export interface PropertyListProps {
  children: React.ReactNode
  className?: string
}

export interface PropertyProps {
  label: string
  children: React.ReactNode
  /** Render the value in the mono/scientific font (identifiers, numbers). */
  mono?: boolean
  /** Preserve long meaningful values by placing the value beneath its label. */
  stacked?: boolean
}

function CodeValue({ children }: { children: React.ReactNode }) {
  if (typeof children !== 'string') return children

  return children.split(/([,;/:=])/).map((part, index) => (
    <React.Fragment key={`${part}-${index}`}>
      {part}
      {/^[,;/:=]$/.test(part) ? <wbr /> : null}
    </React.Fragment>
  ))
}

function PropertyList({ children, className }: PropertyListProps) {
  return <dl className={cn('space-y-2', className)}>{children}</dl>
}

function Property({ label, children, mono, stacked = false }: PropertyProps) {
  return (
    <div
      className={cn(
        'gap-2',
        stacked ? 'grid' : 'flex items-center justify-between',
      )}
    >
      <dt className="shrink-0 text-xs text-fg-muted">{label}</dt>
      <dd
        className={cn(
          'min-w-0 text-xs font-medium text-fg',
          stacked ? 'break-words text-left' : 'truncate text-right',
          mono && 'font-mono tabular-nums',
          stacked && mono && 'text-[0.6875rem] leading-4 tracking-[-0.015em]',
        )}
      >
        {stacked && mono ? <CodeValue>{children}</CodeValue> : children}
      </dd>
    </div>
  )
}

export { Property, PropertyList }
