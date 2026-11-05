import { Button } from './button'
import { Tooltip } from './tooltip'
import type { IconName } from '#/components/icons'

type ButtonProps = React.ComponentProps<typeof Button>

export type IconButtonProps = Omit<
  ButtonProps,
  'aria-label' | 'children' | 'icon' | 'size' | 'title'
> & {
  /** What the button does. Shown as the tooltip and read out by screen readers. */
  label: string
  icon: IconName
  size?: 'icon' | 'icon-lg'
}

/**
 * A button that is only an icon. The label is the tooltip and the accessible
 * name, so the action is never icon-only to a screen reader or a hover.
 * Keep the main action of a page as a text button; use this for the quiet
 * actions around it.
 */
export function IconButton({
  label,
  icon,
  size = 'icon',
  variant = 'quiet',
  ...props
}: IconButtonProps) {
  return (
    <Tooltip content={label}>
      <Button
        variant={variant}
        size={size}
        icon={icon}
        aria-label={label}
        {...props}
      />
    </Tooltip>
  )
}
