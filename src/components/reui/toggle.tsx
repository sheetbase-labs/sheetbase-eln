/**
 * The stock shadcn `toggle` item, pulled in as `toggle-group`'s registry
 * dependency (`registryDependencies: ["toggle"]`). See `toggle-group.tsx` for
 * the comparison context.
 *
 * Same three edits as the other candidates: `@radix-ui/react-toggle` →
 * `radix-ui`, `cn` from `#/lib/utils`, and the classes restyled to Sheetbase
 * tokens (`bg-muted` → `bg-surface-muted`, `bg-accent`/`text-accent-foreground`
 * → `bg-selection`/`text-fg`).
 */
import * as React from 'react'
import { Toggle as TogglePrimitive } from 'radix-ui'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

const toggleVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-label font-medium transition-colors hover:bg-surface-muted hover:text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-selection data-[state=on]:text-fg',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-border bg-transparent',
      },
      size: {
        default: 'h-9 px-3 min-w-9',
        sm: 'h-8 px-2 min-w-8',
        lg: 'h-10 px-3 min-w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

const Toggle = React.forwardRef<
  React.ComponentRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
))
Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle, toggleVariants }
