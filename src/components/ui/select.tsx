import * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * Styled native `<select>`. Mirrors the `Input` primitive so selects share
 * the same border, height, focus ring and shadow as the rest of the form
 * system. Kept as a native control (rather than a Radix popover) so form
 * participation, keyboard behaviour and `<option>` rendering stay simple
 * and predictable across the notebook editors.
 *
 * `appearance-none` removes the platform-default arrow and grey background
 * so the control matches the white background of `Input`/`Textarea` across
 * browsers. A CSS background SVG chevron is positioned on the right (UI-005).
 */
const chevronSvg =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"

function Select({
  className,
  children,
  style,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'flex h-[30px] w-full min-w-0 appearance-none rounded-md border border-input bg-card px-2 py-1 text-body transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-disabled disabled:text-faint-foreground',
        'pr-8',
        className,
      )}
      style={{
        backgroundImage: chevronSvg,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.5rem center',
        backgroundSize: '1rem',
        ...style,
      }}
      {...props}
    >
      {children}
    </select>
  )
}

export { Select }
