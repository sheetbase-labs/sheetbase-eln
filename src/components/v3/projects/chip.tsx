import { Icon } from '#/components/v3/icons'

// A removable filter chip under a list toolbar.
export function FilterChip({
  children,
  onRemove,
  removeLabel,
}: {
  children: React.ReactNode
  onRemove: () => void
  removeLabel: string
}) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface pl-2 pr-0.5 text-label">
      {children}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="inline-flex size-[18px] cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg"
      >
        <Icon name="x" size={10} />
      </button>
    </span>
  )
}
