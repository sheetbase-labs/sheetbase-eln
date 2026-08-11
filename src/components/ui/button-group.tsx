import * as React from 'react'
import { cn } from '#/lib/utils'

function ButtonGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="group"
      className={cn(
        'inline-flex items-center [&>*]:rounded-none [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md [&>*+*]:-ml-px',
        className,
      )}
      {...props}
    />
  )
}

function ButtonGroupText({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'flex h-9 items-center gap-1.5 border border-input bg-muted/40 px-3 text-sm text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { ButtonGroup, ButtonGroupText }
