import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cn } from '#/lib/utils'

// Dialogs are the only surface with radius-lg and shadow-dialog.
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed left-1/2 top-[12vh] z-50 flex max-h-[80vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-dialog outline-none transition-[opacity,scale] duration-150 data-ending-style:scale-[.98] data-ending-style:opacity-0 data-starting-style:scale-[.98] data-starting-style:opacity-0 max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:max-h-[92dvh] max-md:w-full! max-md:translate-x-0 max-md:rounded-b-none max-md:pb-[env(safe-area-inset-bottom)]',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({
  title,
  description,
}: {
  title: React.ReactNode
  description?: React.ReactNode
}) {
  return (
    <div className="border-b border-border-subtle px-5 pb-3 pt-4">
      <DialogPrimitive.Title className="font-heading text-doc font-semibold">
        {title}
      </DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="mt-0.5 text-caption text-fg-muted">
          {description}
        </DialogPrimitive.Description>
      ) : null}
    </div>
  )
}
export function DialogBody({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3.5 overflow-auto px-5 py-4 max-md:px-4',
        className,
      )}
      {...props}
    />
  )
}
export function DialogFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap justify-end gap-2 border-t border-border-subtle bg-surface-muted px-5 py-3 max-md:px-4 max-md:[&>*]:flex-1',
        className,
      )}
      {...props}
    />
  )
}
