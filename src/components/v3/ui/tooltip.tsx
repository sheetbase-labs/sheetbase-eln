import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '#/lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider
export function Tooltip({
  content,
  children,
}: {
  content: React.ReactNode
  children: React.ReactElement<Record<string, unknown>>
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner sideOffset={6} className="z-50">
          <TooltipPrimitive.Popup
            className={cn(
              'rounded-sm bg-inverse px-2 py-1 text-label text-inverse-foreground transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0',
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
