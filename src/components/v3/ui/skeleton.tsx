import { cn } from '#/lib/utils'

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('rounded-sm bg-skeleton', className)}
      {...props}
    />
  )
}
