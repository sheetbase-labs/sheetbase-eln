import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

/**
 * Badge variants. Status variants (success/warning/danger/info/violet) use
 * semantic colour tokens (--success, --warning, etc.) at low opacity for
 * backgrounds and full colour for text, matching the Brand Guide palette.
 * Status is always conveyed by text or icon as well as colour (DESIGN.md /
 * UI-005), so a badge must contain a text label — colour alone is never the
 * only signal.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border bg-background text-foreground',
        success:
          'border-success/20 bg-success/10 text-success',
        warning:
          'border-warning/30 bg-warning/15 text-warning-foreground',
        danger:
          'border-destructive/20 bg-destructive/10 text-destructive',
        info: 'border-info/20 bg-info/10 text-info',
        violet:
          'border-violet/20 bg-violet/10 text-violet',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants, type BadgeProps }
