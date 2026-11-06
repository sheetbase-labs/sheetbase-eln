import type { LinkProps } from '@tanstack/react-router'
import type { IconName } from '#/components/icons'
import type { NavVisibility } from '#/lib/nav-visibility'
import { t } from '#/copy'

// Main navigation: four everyday places, then the rest in folding groups.
//
// SHELL-01.2: an item may declare who can see it (`roles` / `capability`, see
// `nav-visibility.ts`). Items with neither stay visible to every member. The
// app currently restricts back-office surfaces inside Settings, not the
// everyday scientific work listed here, so none is hidden today; the shell
// filters with the same predicate so a future restricted item only has to
// declare its roles.
export type NavItem = NavVisibility & {
  /** A stable name for the page, used when a lab hides it from the sidebar. */
  key: string
  label: string
  icon: IconName
  link: LinkProps
  count?: string
}

/**
 * Home is the Home page only. Help is reached from the account menu and is no
 * destination of its own, so on a help page the rail highlights nothing rather
 * than pointing at a Home the reader is not on.
 */
export function isHomePage(pathname: string): boolean {
  return pathname === '/'
}

/** The four places everyone uses every day. They are always shown. */
export const primaryNav: NavItem[] = [
  { key: 'home', label: 'Home', icon: 'home', link: { to: '/' } },
  { key: 'inbox', label: 'Inbox', icon: 'inbox', link: { to: '/inbox' } },
  // Opens with the filter builder showing: the way to ask a question by
  // type, project, owner or field rather than by words alone.
  {
    key: 'search',
    label: 'Search',
    icon: 'search',
    link: { to: '/search', search: { builder: true } },
  },
  {
    key: 'schedule',
    label: 'Schedule',
    icon: 'calendar',
    link: { to: '/schedule' },
  },
]

export type NavGroupKey = 'work' | 'lab' | 'data' | 'methods'

export interface NavGroup {
  key: NavGroupKey
  label: string
  items: NavItem[]
}

/**
 * Everything else, in four groups that fold. A lab can hide the pages it does
 * not use (Settings > Lab setup > Sidebar); a hidden page still opens from
 * search, links and the command palette. Projects and Experiments are the
 * notebook itself, so they cannot be hidden.
 */
export const navGroups: NavGroup[] = [
  {
    key: 'work',
    label: t('settings.shell.nav.groups.work'),
    items: [
      {
        key: 'projects',
        label: 'Projects',
        icon: 'folder',
        link: { to: '/projects' },
      },
      {
        key: 'experiments',
        label: 'Experiments',
        icon: 'flask',
        link: { to: '/experiments' },
      },
      // Ask the lab for work through a form, and follow it to done.
      {
        key: 'requests',
        label: 'Requests',
        icon: 'list',
        link: { to: '/requests' },
      },
      {
        key: 'reports',
        label: 'Reports',
        icon: 'report',
        link: { to: '/reports' },
      },
    ],
  },
  {
    key: 'lab',
    label: t('settings.shell.nav.groups.lab'),
    items: [
      {
        key: 'samples',
        label: 'Samples',
        icon: 'tube',
        link: { to: '/samples' },
      },
      {
        key: 'materials',
        label: 'Materials',
        icon: 'box',
        link: { to: '/materials' },
      },
      // Constructs, cell lines and antibodies, each with one number.
      {
        key: 'registry',
        label: 'Registry',
        icon: 'tag',
        link: { to: '/registry' },
      },
      // An instrument is an everyday bench object: it has an identifier, a
      // status, qualification and calibration dates and bookings. Parser and
      // connection set-up stays in Settings > Lab setup.
      {
        key: 'instruments',
        label: 'Instruments',
        icon: 'plug',
        link: { to: '/instruments' },
      },
      // Boxes leaving the lab or arriving, with what is in them.
      {
        key: 'shipments',
        label: 'Shipments',
        icon: 'move',
        link: { to: '/shipments' },
      },
      // Plate reads checked against their own controls, potency, and the
      // transfer files for liquid handlers.
      {
        key: 'plates',
        label: 'Plates',
        icon: 'flask',
        link: { to: '/plates' },
      },
      // Incidents, deviations and near misses: any models the lab ticks as a log.
      {
        key: 'incidents',
        label: 'Incidents',
        icon: 'warn',
        link: { to: '/incidents' },
      },
    ],
  },
  {
    key: 'data',
    label: t('settings.shell.nav.groups.data'),
    items: [
      {
        key: 'datasets',
        label: 'Datasets',
        icon: 'table',
        link: { to: '/datasets' },
      },
      {
        key: 'analysis',
        label: 'Analysis',
        icon: 'chart',
        link: { to: '/analysis' },
      },
      {
        key: 'pipelines',
        label: 'Pipelines',
        icon: 'pipeline',
        link: { to: '/pipelines' },
      },
    ],
  },
  {
    key: 'methods',
    label: t('settings.shell.nav.groups.methods'),
    items: [
      {
        key: 'protocols',
        label: 'Protocols',
        icon: 'protocol',
        link: { to: '/protocols' },
      },
      {
        key: 'templates',
        label: 'Templates',
        icon: 'template',
        link: { to: '/templates' },
      },
    ],
  },
]

/** Every grouped page, in sidebar order. */
export const recordNav: NavItem[] = navGroups.flatMap((g) => g.items)

/** Pages a lab may not hide: the notebook itself. */
export const alwaysShownPages: ReadonlySet<string> = new Set([
  'projects',
  'experiments',
])

/** Whether a lab may hide a page from its sidebar. */
export function canHideNavPage(key: string): boolean {
  return recordNav.some((i) => i.key === key) && !alwaysShownPages.has(key)
}

/**
 * Models are lab set-up, so they sit in Settings > Lab setup rather than the
 * sidebar. The page itself stays at /models; the palette still lists it.
 */
export const modelsPlace: NavItem = {
  key: 'models',
  label: 'Models',
  icon: 'schema',
  link: { to: '/models' },
}

/** The groups as the sidebar shows them: hidden pages and empty groups left
 * out. A page the lab may not hide is shown whatever the list says. */
export function visibleNavGroups(
  groups: readonly NavGroup[],
  hidden: readonly string[],
): NavGroup[] {
  const off = new Set(hidden.filter(canHideNavPage))
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !off.has(i.key)) }))
    .filter((g) => g.items.length > 0)
}
