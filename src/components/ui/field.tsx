import * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * Form field primitives. These compose native elements so labels,
 * descriptions and errors are exposed to assistive technology
 * programmatically. Pair `FieldLabel` with an input via `htmlFor`/`id`, and
 * reference `FieldDescription`/`FieldError` from the input with
 * `aria-describedby` so screen readers announce them.
 */
function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field"
      className={cn('grid gap-1.5', className)}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-group"
      className={cn('grid gap-4', className)}
      {...props}
    />
  )
}

function FieldLabel({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="field-label"
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function FieldError({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn('text-xs font-medium text-destructive', className)}
      {...props}
    />
  )
}

export { Field, FieldGroup, FieldLabel, FieldDescription, FieldError }
