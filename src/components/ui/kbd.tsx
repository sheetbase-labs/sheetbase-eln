import * as React from 'react'
import { cn } from '#/lib/utils'

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center rounded border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground shadow-[0_1px_0_0_var(--border)]',
        className,
      )}
      {...props}
    />
  )
}
export { Kbd }
