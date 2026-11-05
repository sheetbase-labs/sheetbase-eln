import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Icon } from '#/components/icons'
import { cn } from '#/lib/utils'
import { t } from '#/copy'
import { KeyboardAware } from '#/lib/use-keyboard-inset'

// Sheet: a panel that slides in from an edge. Used for the navigation drawer on small screens and for the
// inspector below desktop width (right side on laptops, bottom sheet on tablets and phones).
export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

const sides = {
  left: 'inset-y-0 left-0 h-dvh w-[min(300px,85vw)] border-r pb-[env(safe-area-inset-bottom)] data-starting-style:-translate-x-full data-ending-style:-translate-x-full',
  right:
    'inset-y-0 right-0 h-dvh w-[min(360px,90vw)] border-l pb-[env(safe-area-inset-bottom)] data-starting-style:translate-x-full data-ending-style:translate-x-full',
  bottom:
    'inset-x-0 bottom-(--kb-lift) max-h-(--sheet-max-h) rounded-t-xl border-t pb-[var(--kb-safe-bottom,env(safe-area-inset-bottom))] data-starting-style:translate-y-full data-ending-style:translate-y-full',
  // right on laptops, bottom sheet below lg
  auto: 'inset-x-0 bottom-(--kb-lift) max-h-(--sheet-max-h) rounded-t-xl border-t max-lg:pb-[var(--kb-safe-bottom,env(safe-area-inset-bottom))] data-starting-style:translate-y-full data-ending-style:translate-y-full lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:h-dvh lg:max-h-none lg:w-[360px] lg:rounded-none lg:border-l lg:border-t-0 lg:data-starting-style:translate-x-full lg:data-starting-style:translate-y-0 lg:data-ending-style:translate-x-full lg:data-ending-style:translate-y-0',
} as const

export function SheetContent({
  side = 'auto',
  title,
  className,
  children,
  ...props
}: Omit<DialogPrimitive.Popup.Props, 'title'> & {
  side?: keyof typeof sides
  title: React.ReactNode
}) {
  return (
    <DialogPrimitive.Portal>
      <KeyboardAware />
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
        <div
          className={cn(
            'flex items-center gap-2 border-b border-border-subtle px-4 py-2.5',
            // A full-height sheet runs under the status bar of the installed
            // app, so its header clears it.
            (side === 'left' || side === 'right') &&
              'standalone:pt-[calc(0.625rem+env(safe-area-inset-top))]',
          )}
        >
          <DialogPrimitive.Title className="flex-1 font-heading text-[15px] font-semibold">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label={t('common.actions.close')}
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
