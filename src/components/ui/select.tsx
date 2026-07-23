import * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * Styled native `<select>`. Mirrors the `Input` primitive so selects share
 * the same border, height, focus ring and shadow as the rest of the form
 * system. Kept as a native control (rather than a Radix popover) so form
 * participation, keyboard behaviour and `<option>` rendering stay simple
 * and predictable across the notebook editors.
 */
function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export { Select }
