import { t } from '#/copy'
import { primaryNav, recordNav } from '#/components/shell/nav'

/**
 * The page the person is on, by the name the sidebar gives it, so the
 * assistant knows "this week" on the Schedule means the schedule. Only the
 * name and the address go to the server, never what the page shows.
 */
export interface AssistantPage {
  path: string
  title: string
}

const PAGES: Array<{ prefix: string; title: string }> = [
  ...[...primaryNav, ...recordNav].map((item) => ({
    prefix: String(item.link.to),
    title: item.label,
  })),
  { prefix: '/stocktake', title: 'Stocktake' },
  { prefix: '/models', title: 'Models' },
  { prefix: '/settings', title: 'Settings' },
  { prefix: '/inbox', title: 'Inbox' },
]

export function pageFromPathname(
  pathname: string,
  search = '',
): AssistantPage | null {
  let best: { prefix: string; title: string } | null = null

  for (const page of PAGES) {
    const matches =
      page.prefix === '/'
        ? pathname === '/'
        : pathname === page.prefix || pathname.startsWith(`${page.prefix}/`)

    if (matches && (!best || page.prefix.length > best.prefix.length)) {
      best = page
    }
  }

  if (!best) return null

  return {
    path: `${pathname}${search}`.slice(0, 200),
    title: best.title,
  }
}

/** Questions that fit the page, for an empty chat. */
export function pageSuggestions(page: AssistantPage | null): string[] {
  const say = (
    key:
      | 'myBookings'
      | 'freeTomorrow'
      | 'bookForMe'
      | 'openRequests'
      | 'myRequests'
      | 'openShipments'
      | 'openIncidents',
  ) => t(`notebook.assistantPanel.pageSuggest.${key}`)

  switch (page?.title) {
    case 'Schedule':
    case 'Instruments':
      return [say('myBookings'), say('freeTomorrow'), say('bookForMe')]
    case 'Requests':
      return [say('openRequests'), say('myRequests')]
    case 'Shipments':
      return [say('openShipments')]
    case 'Incidents':
      return [say('openIncidents')]
    default:
      return [say('myBookings'), say('openRequests')]
  }
}
