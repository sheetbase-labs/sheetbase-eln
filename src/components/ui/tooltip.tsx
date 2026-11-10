import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '#/lib/utils'
import { useFloatingBoundary } from '#/lib/visible-area'

export const TooltipProvider = TooltipPrimitive.Provider

export function Tooltip({
  content,
  children,
}: {
  content: React.ReactNode
  children: React.ReactElement
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPositioner>
          <TooltipPrimitive.Popup
            className={cn(
              'rounded-sm bg-inverse px-2 py-1 text-label text-inverse-foreground transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0',
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPositioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

/** Rendered inside the portal, so it only measures the screen while open. */
function TooltipPositioner({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Positioner
      sideOffset={6}
      className="z-50"
      {...useFloatingBoundary()}
    >
      {children}
    </TooltipPrimitive.Positioner>
  )
}
