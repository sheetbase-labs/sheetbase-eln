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
  /** Let a long value wrap beside its label instead of ending in an ellipsis. */
  wrap?: boolean
}

function CodeValue({ children }: { children: React.ReactNode }) {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- `React.ReactNode` is a closed union with no discriminator of its own, so `typeof` is the only runtime test for a text child; every other node (element, number, null) passes through untouched.
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

function Property({
  label,
  children,
  mono,
  stacked = false,
  wrap = false,
}: PropertyProps) {
  return (
    // Labels share one column and values start on one edge beside them, so
    // the eye runs down a single line of values instead of zigzagging from a
    // label on the left to a value pushed to the far right.
    <div
      className={cn(
        'grid gap-x-3 gap-y-1',
        !stacked && 'min-h-6 grid-cols-[6.5rem_minmax(0,1fr)] items-center',
      )}
    >
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd
        className={cn(
          'min-w-0 text-xs font-medium text-fg',
          stacked || wrap ? 'break-words' : 'truncate',
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
