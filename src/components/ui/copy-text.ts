import { toast } from './sonner'

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
