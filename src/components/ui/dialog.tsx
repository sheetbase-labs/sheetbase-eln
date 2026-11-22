import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cn } from '#/lib/utils'
import { KeyboardAware } from '#/lib/use-keyboard-inset'

// Dialogs are the only surface with radius-lg and shadow-dialog.
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

/** Text-like inputs where Enter means "done", not a new line or a choice. */
const ENTER_SUBMITS = new Set([
  'text',
  'email',
  'number',
  'password',
  'search',
  'tel',
  'url',
  'date',
])

/**
 * Enter in a one-line field presses the dialog's one primary button, as it
 * does in a form. Most dialogs here are not `<form>`s, so without this Enter
 * did nothing. Fields inside a real form, pickers that use Enter to choose,
 * and dialogs with no single enabled primary button are left alone.
 */
function submitOnEnter(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Enter' || event.defaultPrevented) return

  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return

  if (event.nativeEvent.isComposing) return

  const field = event.target

  if (!(field instanceof HTMLInputElement)) return

  if (!ENTER_SUBMITS.has(field.type) || field.form) return

  if (field.getAttribute('role') === 'combobox') return

  if (field.hasAttribute('aria-autocomplete')) return

  // Only a field in the dialog itself: a menu or list opened from it is
  // rendered elsewhere in the page but still bubbles here.
  if (!event.currentTarget.contains(field)) return

  const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(
    'button[data-variant="primary"]',
  )

  if (buttons.length !== 1 || buttons[0].disabled) return

  event.preventDefault()
  buttons[0].click()
}

export function DialogContent({
  className,
  children,
  onKeyDown,
  ...props
}: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <KeyboardAware />
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-scrim animate-fade-in transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:opacity-0" />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed left-1/2 top-[12vh] z-50 flex max-h-[80vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-dialog outline-none data-open:animate-dialog-in max-md:data-open:animate-dialog-sheet-in transition-[opacity,scale,translate] duration-200 ease-out data-ending-style:scale-[.97] data-ending-style:duration-150 data-starting-style:scale-[.97] md:data-ending-style:opacity-0 md:data-starting-style:opacity-0 max-md:data-ending-style:scale-100 max-md:data-starting-style:scale-100 max-md:duration-250 max-md:ease-drawer max-md:data-ending-style:translate-y-full max-md:data-starting-style:translate-y-full max-md:inset-x-0 max-md:bottom-(--kb-lift) max-md:top-auto max-md:max-h-(--sheet-max-h) max-md:w-full! max-md:translate-x-0 max-md:rounded-b-none max-md:pb-[var(--kb-safe-bottom,env(safe-area-inset-bottom))]',
          className,
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          submitOnEnter(event)
        }}
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
