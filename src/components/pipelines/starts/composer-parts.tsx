import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'

export function Row({
  icon,
  type,
  children,
  action,
}: {
  icon: IconName
  type: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="grid min-h-[34px] grid-cols-[16px_88px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-caption max-md:grid-cols-[16px_minmax(0,1fr)_auto]">
      <Icon name={icon} size={14} className="text-fg-muted" />
      <span className="font-medium max-md:col-span-1">{type}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-md:order-last max-md:col-span-3 max-md:pl-6">
        {children}
      </div>
      <div className="flex items-center justify-end">{action}</div>
    </div>
  )
}

export function Group({
  children,
  head,
}: {
  children: React.ReactNode
  head: React.ReactNode
}) {
  return (
    <div className="border-t border-border-subtle px-3 pb-2 pt-2.5 first:border-t-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-body font-semibold">
        {head}
      </div>
      {children}
    </div>
  )
}

export const OpTag = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-[4px] border border-border bg-surface-muted px-[5px] py-px font-mono text-[10px] font-semibold tracking-[0.04em] text-fg-muted">
    {children}
  </span>
)

export const LinkButton = ({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) => (
  <button
    type="button"
    onClick={onClick}
    className="cursor-pointer bg-transparent p-0 text-caption text-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
  >
    {children}
  </button>
)
