import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

export function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.Root.Props) {
  // A native <button> rather than Base UI's default <span>: only a labelable
  // element is named by the <label> every call site wraps this in, and only a
  // real button is activated when that label's text is clicked. The span Base
  // UI renders by default leaves the control with no accessible name, because
  // the label's labelled control becomes the visually hidden input instead.
  //
  // `data-indeterminate` fills the box exactly as `data-checked` does. Without
  // it the mixed state kept `bg-surface` while the indicator's tick inherited
  // `text-on-accent`, so the mark was painted white on white and the header
  // checkbox of a partly selected grid looked empty. The mark stays a tick: a
  // filled box is the fix for the invisible mark, not a new glyph.
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      nativeButton
      render={<button type="button" />}
      className={cn(
        'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-border-strong bg-surface text-on-accent data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary data-disabled:cursor-default data-disabled:bg-surface-disabled focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
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
