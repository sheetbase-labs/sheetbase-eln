import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

/**
 * Inline alert surface. Status is conveyed by text as well as colour
 * (UI-005); use a descriptive heading or message inside. `role="alert"` is
 * applied by the caller when the message is assertive (the default here is
 * a polite, surfaced notice).
 */
const alertVariants = cva(
  'relative w-full rounded-md border p-3 text-xs gap-2',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted/40 text-foreground',
        destructive: 'border-destructive/40 bg-destructive/5 text-destructive',
        warning: 'border-warning/50 bg-warning/5 text-warning-foreground',
        info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

interface AlertProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h5
      data-slot="alert-title"
      className={cn('font-medium leading-none tracking-tight', className)}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-xs leading-relaxed', className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
