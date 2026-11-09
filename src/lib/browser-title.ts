import { t } from '#/copy'

/**
 * The browser tab's title: the page's own name and the app, with the Inbox's
 * unread count in front while there is something waiting. A record names its
 * identifier first, so five open experiments are told apart in the tab strip,
 * the history and a bookmark.
 */
export function browserTitle(input: {
  title?: string
  identifier?: string
  unread?: number
}): string {
  const app = t('account.browserTitle.app')
  const title = input.title?.trim()
  const identifier = input.identifier?.trim()

  const name =
    identifier && title && !title.startsWith(identifier)
      ? `${identifier} ${title}`
      : (title ?? identifier)

  const page = name ? t('account.browserTitle.page', { title: name, app }) : app

  return input.unread && input.unread > 0
    ? t('account.browserTitle.unread', {
        count: input.unread > 99 ? '99+' : input.unread,
        title: page,
      })
    : page
}

/** The shell's Inbox count is text ("12", "99+"); read the number from it. */
export function unreadFromShellCount(count: string | null | undefined): number {
  if (!count) return 0
  const parsed = Number.parseInt(count, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
