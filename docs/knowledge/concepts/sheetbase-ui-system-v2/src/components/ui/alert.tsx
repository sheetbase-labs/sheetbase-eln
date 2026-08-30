import * as React from 'react'
import { cva  } from 'class-variance-authority'
import type {VariantProps} from 'class-variance-authority';
import { cn } from '#/lib/utils'

const alertVariants = cva('relative w-full rounded-lg border p-4 [&>svg+div]:translate-y-[-2px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7', { variants: { variant: { default: 'bg-background text-foreground', destructive: 'border-destructive/40 text-destructive [&>svg]:text-destructive', info: 'border-blue-200 bg-blue-50/70 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100', success: 'border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100' } }, defaultVariants: { variant: 'default' } })
function Alert({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) { return <div role='alert' className={cn(alertVariants({ variant }), className)} {...props} /> }
function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) { return <h5 className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} /> }
function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} /> }
export { Alert, AlertTitle, AlertDescription }
