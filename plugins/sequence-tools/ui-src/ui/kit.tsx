/**
 * The small set of controls the sequence tools use, drawn with the colours the
 * plugin frame hands over. It stands in for the app's own components, which
 * cannot run inside the sandboxed frame.
 */
import * as React from 'react'

import { cn } from '#/lib/utils'

const ICONS: Record<string, string> = {
  copy: 'M9 9h10v10H9zM5 15V5h10',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14',
  upload: 'M12 15V4m0 0L8 8m4-4l4 4M5 19h14',
  expand: 'M6 14l6-6 6 6',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4',
  minus: 'M6 12h12',
  plus: 'M12 5v14M5 12h14',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  info: 'M12 8v.01M12 11v5M12 3a9 9 0 100 18 9 9 0 000-18z',
  warn: 'M12 9v4M12 17v.01M10.3 4.2L2.8 17.5A2 2 0 004.5 20.5h15a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z',
  chevron: 'M6 9l6 6 6-6',
}

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name] ?? ICONS.info} />
    </svg>
  )
}

const BUTTON =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:border-border disabled:bg-surface-disabled disabled:text-fg-faint'
const VARIANTS = {
  secondary: 'border-border bg-surface text-fg hover:bg-surface-hover',
  primary:
    'border-primary bg-primary text-primary-foreground hover:bg-primary-hover',
  quiet: 'border-transparent bg-transparent text-fg hover:bg-surface-hover',
  danger: 'border-border bg-surface text-danger-text hover:bg-danger-wash',
}
const SIZES = {
  sm: 'h-6 px-2 text-label',
  md: 'h-7 px-2.5 text-body',
  icon: 'size-7 px-0',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...props
}: Omit<React.ComponentProps<'button'>, 'size'> & {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  icon?: string
}) {
  return (
    <button
      type={type}
      className={cn(BUTTON, VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 12 : 14} /> : null}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  icon,
  variant = 'quiet',
  ...props
}: Omit<React.ComponentProps<'button'>, 'size'> & {
  label: string
  icon: string
  variant?: keyof typeof VARIANTS
}) {
  return (
    <Button
      variant={variant}
      size="icon"
      icon={icon}
      aria-label={label}
      title={label}
      {...props}
    />
  )
}

/** A caller's own width or height replaces the default (no class merging here). */
const own = (className: string | undefined, prefix: 'w' | 'h') =>
  new RegExp(`(^|\\s)${prefix}-`).test(className ?? '')

export function Input({
  className,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-[30px] rounded-md border border-border bg-surface px-2 text-body text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus read-only:text-fg-muted',
        !own(className, 'w') && 'w-full',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'rounded-md border border-border bg-surface px-2 py-1.5 text-body text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
        !own(className, 'w') && 'w-full',
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
  className,
  children,
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
      <span className="font-medium text-fg">{label}</span>
      {children}
      {error ? (
        <span className="text-danger-text">{error}</span>
      ) : hint ? (
        <span className="text-fg-muted">{hint}</span>
      ) : null}
    </label>
  )
}

export function Select({
  className,
  size = 'md',
  children,
  ...props
}: Omit<React.ComponentProps<'select'>, 'size'> & { size?: 'md' | 'sm' }) {
  return (
    <span
      className={cn(
        'relative block',
        size === 'sm' ? 'h-[26px] text-label' : 'h-[30px] text-body',
        className,
      )}
    >
      <select
        className="h-full w-full cursor-pointer appearance-none rounded-md border border-border bg-surface pl-2 pr-7 text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:bg-surface-disabled disabled:text-fg-muted"
        {...props}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted">
        <Icon name="chevron" size={12} />
      </span>
    </span>
  )
}

export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  ...props
}: Omit<React.ComponentProps<'input'>, 'onChange' | 'checked'> & {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      className="size-4 shrink-0 cursor-pointer accent-[var(--sb-primary)]"
      checked={checked ?? false}
      disabled={disabled}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  )
}

export interface TabItem {
  key?: string
  label: React.ReactNode
  count?: React.ReactNode
}

export function Tabs({
  items,
  value,
  onValueChange,
  label,
}: {
  mode?: 'state'
  variant?: string
  label: string
  value: string
  onValueChange: (key: string) => void
  items: TabItem[]
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-4 overflow-x-auto border-b border-border"
    >
      {items.map((item) => {
        const key = item.key ?? ''
        const active = key === value
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(key)}
            className={cn(
              'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 bg-transparent px-0.5 text-body font-medium hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
              active
                ? 'border-primary text-fg'
                : 'border-transparent text-fg-muted',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="text-fg-muted">{item.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

const NOTICE = {
  info: 'border-border bg-surface-muted text-fg',
  warn: 'border-warning-border bg-warning-wash text-fg',
  bad: 'border-danger-border bg-danger-wash text-fg',
  good: 'border-border bg-success-wash text-fg',
}

export function Notice({
  tone = 'info',
  action,
  title,
  children,
  className,
}: {
  tone?: keyof typeof NOTICE
  action?: React.ReactNode
  title?: React.ReactNode
  children?: React.ReactNode
  className?: string
  icon?: string | false
}) {
  return (
    <div
      role={tone === 'bad' ? 'alert' : undefined}
      className={cn(
        'flex flex-wrap items-start gap-2 rounded-md border px-3 py-2 text-body',
        NOTICE[tone],
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-[14rem]">
        {title ? <span className="font-semibold">{title} </span> : null}
        {children}
      </div>
      {action}
    </div>
  )
}

export function Spinner({ size = 14 }: { size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      className="animate-spin text-fg-muted"
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 019 9" strokeLinecap="round" />
    </svg>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  icon?: string
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-md border border-dashed border-border p-4">
      <p className="text-body font-medium text-fg">{title}</p>
      {description ? (
        <p className="text-label text-fg-muted">{description}</p>
      ) : null}
      {action}
    </div>
  )
}

/** Messages go to the host, which shows them as toasts. */
export const toast = Object.assign(
  (text: string) => sheetbase.notify(text, 'neutral'),
  {
    error: (text: string) => sheetbase.notify(text, 'danger'),
    success: (text: string) => sheetbase.notify(text, 'success'),
  },
)

export async function copyText(
  value: string,
  {
    copiedMessage = 'Copied',
    failedMessage = 'Could not copy. Select the value and copy it by hand.',
  }: { copiedMessage?: string; failedMessage?: string } = {},
): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast(copiedMessage)
  } catch {
    toast.error(failedMessage)
  }
}

export function TableBox({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('overflow-x-auto rounded-md border border-border', className)}
      {...props}
    />
  )
}
export function Table({
  className,
  caption,
  children,
  ...props
}: React.ComponentProps<'table'> & { caption?: React.ReactNode }) {
  return (
    <table className={cn('num w-full text-body', className)} {...props}>
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      {children}
    </table>
  )
}
export const TableHeader = (p: React.ComponentProps<'thead'>) => <thead {...p} />
export function TableBody({
  children,
  empty,
  colSpan,
  ...props
}: React.ComponentProps<'tbody'> & {
  loading?: boolean
  empty?: React.ReactNode
  colSpan?: number
}) {
  const hasRows = React.Children.count(children) > 0
  return (
    <tbody {...props}>
      {hasRows || empty === undefined ? (
        children
      ) : (
        <tr>
          <td colSpan={colSpan} className="h-[44px] px-2.5 text-label text-fg-muted">
            {empty}
          </td>
        </tr>
      )}
    </tbody>
  )
}
export function TableRow({
  className,
  selected,
  ...props
}: React.ComponentProps<'tr'> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn('group/row', className)}
      {...props}
    />
  )
}
export function TableHead({
  className,
  align,
  ...props
}: React.ComponentProps<'th'> & { align?: 'right' }) {
  return (
    <th
      className={cn(
        'h-[31px] whitespace-nowrap border-b border-border bg-surface-muted px-2.5 text-left text-label font-medium text-fg-muted',
        align === 'right' && 'text-right',
        className,
      )}
      {...props}
    />
  )
}
export function TableCell({
  className,
  align,
  ...props
}: React.ComponentProps<'td'> & { align?: 'right' }) {
  return (
    <td
      className={cn(
        'h-[33px] whitespace-nowrap border-b border-border-subtle px-2.5 group-hover/row:bg-row-hover group-aria-selected/row:bg-selection',
        align === 'right' && 'text-right',
        className,
      )}
      {...props}
    />
  )
}
