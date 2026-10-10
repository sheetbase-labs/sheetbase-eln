import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { cn } from '#/lib/utils'

/**
 * Segmented control (DSYS-04): a small set of mutually exclusive options,
 * used for the appearance switch. Options may carry an icon name.
 */
export interface SegmentedProps {
  options: string[]
  /** Pipe-separated icon names, one per option. */
  icons?: string
  value: string
  onChange: (value: string) => void
  className?: string
  'aria-label'?: string
}

export function Segmented({
  options,
  icons,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: SegmentedProps) {
  const iconList = icons ? icons.split('|') : []
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="segmented"
      className={cn(
        'inline-flex gap-0.5 rounded-md border border-border bg-muted p-0.5',
        className,
      )}
    >
      {options.map((option, index) => {
        const active = value === option
        const icon = iconList[index]
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-sm px-2 text-caption font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              active &&
                'bg-card text-foreground shadow-overlay ring-1 ring-border',
            )}
          >
            {icon ? <Icon name={icon as IconName} size={12} /> : null}
            {option}
          </button>
        )
      })}
    </div>
  )
}
