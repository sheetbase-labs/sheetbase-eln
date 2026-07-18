import * as React from 'react'
import { cn } from '#/lib/utils'

function Empty({ className, ...props }: React.ComponentProps<'div'>) { return <div className={cn('flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center',className)} {...props}/> }
function EmptyIcon({ className, ...props }: React.ComponentProps<'div'>) { return <div className={cn('mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground [&>svg]:size-5',className)} {...props}/> }
function EmptyTitle({ className, ...props }: React.ComponentProps<'h3'>) { return <h3 className={cn('text-sm font-semibold',className)} {...props}/> }
function EmptyDescription({ className, ...props }: React.ComponentProps<'p'>) { return <p className={cn('mt-1 max-w-sm text-sm text-muted-foreground',className)} {...props}/> }
function EmptyActions({ className, ...props }: React.ComponentProps<'div'>) { return <div className={cn('mt-4 flex items-center gap-2',className)} {...props}/> }
export { Empty, EmptyIcon, EmptyTitle, EmptyDescription, EmptyActions }
