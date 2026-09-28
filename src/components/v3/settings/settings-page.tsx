import { cn } from '#/lib/utils'
import { Checkbox } from '#/components/v3/ui/checkbox'

// UI port (roadmap-4/ui-app3): the header and body chrome every settings page
// shares; the section nav lives in the settings layout route.
export function SettingsHeader({
  title,
  count,
  actions,
  children,
  border = true,
  className,
}: {
  title: React.ReactNode
  count?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  border?: boolean
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-1 px-4 pb-3 pt-4 md:px-6',
        border && 'border-b border-border',
        className,
      )}
    >
      <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-2">
        <h1 className="text-title max-md:text-[18px] max-md:leading-6">
          {title}
        </h1>
        {count != null ? (
          <span className="num text-body text-fg-muted">{count}</span>
        ) : null}
        <span className="flex-1" />
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 max-md:basis-full">
            {actions}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="text-label text-fg-muted">{children}</div>
      ) : null}
    </header>
  )
}

export function SettingsBody({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-6 px-4 py-5 md:px-6', className)}
      {...props}
    />
  )
}

// The design system's .check: a checkbox, its label and one muted line on the
// consequence.
export function CheckRow({
  title,
  body,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  title: React.ReactNode
  body?: React.ReactNode
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2 text-body',
        disabled && 'cursor-default',
        className,
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v)}
        disabled={disabled}
        className="mt-px"
      />
      <span className="min-w-0">
        <span className="block">{title}</span>
        {body ? (
          <span className="mt-0.5 block text-label text-fg-muted">{body}</span>
        ) : null}
      </span>
    </label>
  )
}
