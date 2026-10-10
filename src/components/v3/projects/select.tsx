import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

// Native select styled like Input. Wrap in <Field> (a <label>) so it gets its name.
export function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<'select'>) {
  return (
    <span className={cn('relative block', className)}>
      <select
        className="h-[30px] w-full cursor-pointer appearance-none rounded-md border border-border bg-surface pl-2 pr-7 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus aria-invalid:border-danger aria-invalid:shadow-[0_0_0_1px_var(--danger)] disabled:cursor-default disabled:bg-surface-disabled disabled:text-fg-muted"
        {...props}
      >
        {children}
      </select>
      <Icon
        name="chevronDown"
        size={14}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted"
      />
    </span>
  )
}
