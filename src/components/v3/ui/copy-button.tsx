import { Button } from './button'
import { toast } from './sonner'

/**
 * Copy one value, and report what actually happened.
 *
 * Nine files hand-rolled `navigator.clipboard.writeText`: five of them for a
 * single value beside a control, with the try/catch, the two message strings and
 * the success/failure honesty written out each time. `copyText` is that
 * behaviour in one place — a refused or absent clipboard means no copy
 * happened, and the user is told that rather than congratulated — and
 * `CopyButton` is the control for the button-shaped sites.
 *
 * The feedback is the app's toast, which is what every migrated site already
 * used, so the vocabulary does not change.
 *
 * Not for: copying the reader's *text selection* (`window.getSelection`), where
 * there is no value to hand over and the control is an action rather than a
 * value's affordance; that stays with the surface that owns the selection.
 */

export interface CopyTextOptions {
  /** Confirmed on success. */
  readonly copiedMessage?: string
  /** Stated on failure; must not claim the value reached the clipboard. */
  readonly failedMessage?: string
}

/**
 * Write `value` to the clipboard and report the outcome. Resolves either way —
 * the caller has nothing to do differently, because the user has already been
 * told which happened.
 */
export async function copyText(
  value: string,
  {
    copiedMessage = 'Copied',
    failedMessage = 'Could not copy. Select the value and copy it by hand.',
  }: CopyTextOptions = {},
): Promise<void> {
  try {
    // A refused or unavailable clipboard (permission denied, insecure context)
    // either rejects or throws here; both mean no copy happened.
    await navigator.clipboard.writeText(value)
    toast(copiedMessage)
  } catch {
    toast.error(failedMessage)
  }
}

export type CopyButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  'onClick' | 'icon'
> & {
  /** What reaches the clipboard. */
  readonly value: string
  /**
   * Visible label. Omit for an icon-only control, which then needs an
   * `aria-label` naming the value it copies.
   */
  readonly children?: React.ReactNode
}

export function CopyButton({
  value,
  children,
  size = 'sm',
  variant = 'quiet',
  copiedMessage,
  failedMessage,
  ...props
}: CopyButtonProps & CopyTextOptions) {
  return (
    <Button
      size={size}
      variant={variant}
      icon="copy"
      data-slot="copy-button"
      onClick={() => void copyText(value, { copiedMessage, failedMessage })}
      {...props}
    >
      {children}
    </Button>
  )
}
