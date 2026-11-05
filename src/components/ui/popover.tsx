import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from '#/lib/utils'
import { useFloatingBoundary } from '#/lib/visible-area'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverTitle = PopoverPrimitive.Title

export function PopoverContent({
  className,
  align = 'end',
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'align' | 'sideOffset'>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPositioner align={align} sideOffset={sideOffset}>
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'max-h-(--available-height) overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover text-popover-foreground shadow-overlay outline-none transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0',
            className,
          )}
          {...props}
        />
      </PopoverPositioner>
    </PopoverPrimitive.Portal>
  )
}

/** Rendered inside the portal, so it only measures the screen while open. */
function PopoverPositioner(props: PopoverPrimitive.Positioner.Props) {
  return (
    <PopoverPrimitive.Positioner
      className="z-50"
      {...useFloatingBoundary()}
      {...props}
    />
  )
}
