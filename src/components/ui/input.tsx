import { Input as InputPrimitive } from '@base-ui/react/input'
import { cn } from '#/lib/utils'

export function Input({ className, ...props }: InputPrimitive.Props) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        'h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus aria-invalid:border-danger aria-invalid:shadow-[0_0_0_1px_var(--danger)]',
        className,
      )}
      {...props}
    />
  )
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('flex flex-col gap-1 text-label', className)}>
      <span className="font-medium text-fg">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-fg-muted">
            {' '}
            *
          </span>
        ) : null}
      </span>
      {children}
      {error ? (
        <span className="text-danger-text">{error}</span>
      ) : hint ? (
        <span className="text-fg-muted">{hint}</span>
      ) : null}
    </label>
  )
}
