import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

export function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-border-strong bg-surface text-on-accent data-checked:border-primary data-checked:bg-primary data-disabled:cursor-default data-disabled:bg-surface-disabled focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Icon name="check" size={12} strokeWidth={2} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
