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
export { ButtonGroup }
