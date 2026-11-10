/**
 * Hand a link to the phone's own share sheet (messages, mail, AirDrop, another
 * app) where there is one, and copy it where there is not.
 */
export interface SharePayload {
  title: string
  url: string
  text?: string
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

export function canNativeShare(
  nav: Navigator | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator,
): boolean {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Browser capability detection must distinguish missing/noncallable values and cross-realm functions without invoking the native share sheet.
  return typeof nav?.share === 'function'
}

export async function shareLink(
  payload: SharePayload,
  nav: Navigator = navigator,
): Promise<ShareOutcome> {
  if (canNativeShare(nav)) {
    try {
      await nav.share(payload)

      return 'shared'
    } catch (error) {
      // Closing the share sheet is a choice, not a failure.
      if (error instanceof DOMException && error.name === 'AbortError')
        return 'cancelled'
    }
  }

  try {
    await nav.clipboard.writeText(payload.url)

    return 'copied'
  } catch {
    return 'failed'
  }
}
