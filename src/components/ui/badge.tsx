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
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-4 transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-muted text-muted-foreground',
        outline: 'border-border bg-card text-foreground',
        success: 'border-transparent bg-success-wash text-success-text',
        warning: 'border-transparent bg-warning-wash text-warning-text',
        danger: 'border-transparent bg-danger-wash text-danger-text',
        info: 'border-transparent bg-selection text-info',
        violet: 'border-transparent bg-review-wash text-review',
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
