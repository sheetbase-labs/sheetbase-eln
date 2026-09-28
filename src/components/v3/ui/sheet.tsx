import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

// Sheet: a panel that slides in from an edge. Used for the navigation drawer on small screens and for the
// inspector below desktop width (right side on laptops, bottom sheet on tablets and phones).
export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

const sides = {
  left: 'inset-y-0 left-0 h-dvh w-[min(300px,85vw)] border-r data-starting-style:-translate-x-full data-ending-style:-translate-x-full',
  right:
    'inset-y-0 right-0 h-dvh w-[min(360px,90vw)] border-l data-starting-style:translate-x-full data-ending-style:translate-x-full',
  bottom:
    'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t pb-[env(safe-area-inset-bottom)] data-starting-style:translate-y-full data-ending-style:translate-y-full',
  // right on laptops, bottom sheet below lg
  auto: 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t data-starting-style:translate-y-full data-ending-style:translate-y-full lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:h-dvh lg:max-h-none lg:w-[360px] lg:rounded-none lg:border-l lg:border-t-0 lg:data-starting-style:translate-x-full lg:data-starting-style:translate-y-0 lg:data-ending-style:translate-x-full lg:data-ending-style:translate-y-0',
} as const

export function SheetContent({
  side = 'auto',
  title,
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props & {
  side?: keyof typeof sides
  title: React.ReactNode
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogPrimitive.Popup
        data-slot="sheet"
        className={cn(
          'fixed z-50 flex flex-col border-border bg-surface shadow-dialog outline-none transition-transform duration-200 ease-out',
          sides[side],
          className,
        )}
        {...props}
      >
        {side === 'bottom' || side === 'auto' ? (
          <div
            aria-hidden="true"
            className={cn(
              'flex justify-center pt-2',
              side === 'auto' && 'lg:hidden',
            )}
          >
            <span className="h-1 w-9 rounded-full bg-border-strong" />
          </div>
        ) : null}
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <DialogPrimitive.Title className="flex-1 font-heading text-[15px] font-semibold">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label="Close"
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-fg hover:bg-surface-hover"
          >
            <Icon name="x" size={16} />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}
