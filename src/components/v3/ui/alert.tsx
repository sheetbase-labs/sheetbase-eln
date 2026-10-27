import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

// Notice: a local message beside what it describes. Banner: page-wide state strip under the header.
const noticeVariants = cva(
  'flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-md px-3 py-2.5 text-label leading-[18px]',
  {
    variants: {
      tone: {
        info: 'bg-surface-muted',
        warn: 'bg-warning-wash',
        bad: 'bg-danger-wash',
      },
    },
    defaultVariants: { tone: 'info' },
  },
)
const defaultIcon: Record<string, IconName> = {
  info: 'info',
  warn: 'warn',
  bad: 'warn',
  review: 'lock',
}

export function Notice({
  tone,
  icon,
  action,
  title,
  children,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> &
  VariantProps<typeof noticeVariants> & {
    icon?: IconName | false
    action?: React.ReactNode
    title?: React.ReactNode
    children?: React.ReactNode
  }) {
  const t = tone ?? 'info'
  return (
    <div
      role={t === 'bad' ? 'alert' : undefined}
      className={cn(noticeVariants({ tone }), className)}
      {...props}
    >
      {icon !== false ? <Icon name={icon || defaultIcon[t]} size={14} /> : null}
      {/* A narrow notice drops its action under the text instead of squeezing the text into a column. */}
      <div className="min-w-0 flex-1 basis-[14rem]">
        {title ? (
          <span
            className={cn(
              'font-semibold',
              t === 'bad'
                ? 'text-danger-text'
                : t === 'warn'
                  ? 'text-warning-text'
                  : 'text-fg',
            )}
          >
            {title}{' '}
          </span>
        ) : null}
        {children}
      </div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </div>
  )
}

const bannerVariants = cva(
  'flex items-center gap-2.5 border-b px-6 py-2 text-label leading-[18px]',
  {
    variants: {
      tone: {
        info: 'border-border bg-surface-muted',
        warn: 'border-warning-border bg-warning-wash',
        bad: 'border-danger-border bg-danger-wash',
        review: 'border-border bg-review-wash',
      },
    },
    defaultVariants: { tone: 'info' },
  },
)
export function Banner({
  tone,
  icon,
  action,
  title,
  children,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> &
  VariantProps<typeof bannerVariants> & {
    icon?: IconName
    action?: React.ReactNode
    title?: React.ReactNode
    children?: React.ReactNode
  }) {
  const t = tone ?? 'info'
  return (
    <div
      role={t === 'bad' ? 'alert' : 'status'}
      className={cn(bannerVariants({ tone }), className)}
      {...props}
    >
      <Icon name={icon || defaultIcon[t]} size={14} />
      <div className="min-w-0 flex-1">
        {title ? <b className="font-semibold">{title} </b> : null}
        {children}
      </div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </div>
  )
}
