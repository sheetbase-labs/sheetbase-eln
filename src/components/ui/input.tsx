import * as React from 'react'

import { cn } from '#/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-[30px] w-full min-w-0 rounded-md border border-input bg-card px-2 py-1 text-body transition-colors outline-none file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-faint-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-disabled disabled:text-faint-foreground aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
