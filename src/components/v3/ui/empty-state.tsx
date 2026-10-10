import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

export function EmptyState({
  icon,
  title,
  body,
  children,
  className,
}: {
  icon?: IconName
  title: React.ReactNode
  body?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex max-w-[440px] flex-col items-start gap-2 py-8',
        className,
      )}
    >
      {icon ? (
        <span className="text-fg-muted">
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <h2 className="text-section">{title}</h2>
      {body ? (
        <p className="m-0 text-body leading-5 text-fg-muted">{body}</p>
      ) : null}
      {children ? <div className="mt-1 flex gap-2">{children}</div> : null}
    </div>
  )
}
