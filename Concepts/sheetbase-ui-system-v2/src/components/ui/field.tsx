import * as React from 'react'
import { cn } from '#/lib/utils'

function Field({ className, ...props }: React.ComponentProps<'div'>) { return <div className={cn('grid gap-1.5',className)} {...props}/> }
function FieldLabel({ className, ...props }: React.ComponentProps<'label'>) { return <label className={cn('text-sm font-medium',className)} {...props}/> }
function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) { return <p className={cn('text-xs text-muted-foreground',className)} {...props}/> }
function FieldError({ className, ...props }: React.ComponentProps<'p'>) { return <p className={cn('text-xs font-medium text-destructive',className)} {...props}/> }
function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) { return <div className={cn('grid gap-4',className)} {...props}/> }
export { Field, FieldLabel, FieldDescription, FieldError, FieldGroup }
