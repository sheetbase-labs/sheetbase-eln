import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

// Source (design system): where a column or value comes from.
// Local is drawn in link blue because it's the one kind that can't be cited or read by pipelines until promoted.
const kinds = {
  dataset: 'database',
  record: 'link',
  calc: 'code',
  local: 'edit',
} as const
export type SourceKind = keyof typeof kinds

export function Source({
  kind,
  children,
  className,
}: {
  kind: SourceKind
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      data-slot="source"
      className={cn(
        'inline-flex items-center gap-[3px] whitespace-nowrap text-[10px] font-normal leading-[14px]',
        kind === 'local' ? 'text-link' : 'text-fg-muted',
        className,
      )}
    >
      <Icon name={kinds[kind]} size={10} />
      {children}
    </span>
  )
}

/** Before and after of one value. Omit `before` for an added value. */
export function Diff({
  before,
  after,
  className,
}: {
  before?: React.ReactNode
  after?: React.ReactNode
  className?: string
}) {
  return (
    <span data-slot="diff" className={cn('whitespace-nowrap', className)}>
      {before != null && before !== '' ? <del>{before}</del> : null}
      {before != null && before !== '' && after != null ? ' ' : null}
      {after != null ? <ins>{after}</ins> : null}
    </span>
  )
}
