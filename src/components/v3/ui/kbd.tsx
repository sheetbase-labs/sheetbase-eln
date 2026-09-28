import { cn } from '#/lib/utils'

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'rounded-[3px] border border-border bg-surface px-1 font-mono text-[10px] text-fg-muted',
        className,
      )}
      {...props}
    />
  )
}
