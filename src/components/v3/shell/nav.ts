import type { LinkProps } from '@tanstack/react-router'
import type { IconName } from '#/components/v3/icons'
import type { NavVisibility } from '#/lib/nav-visibility'

// Main navigation, ported from sheetbase-app-3 and mapped onto the ELN's route
// tree. Experiments and Protocols appear here once their routes land (the
// capability tasks own them); until then the nav lists only real routes so no
// link 404s.
//
// SHELL-01.2: an item may declare who can see it (`roles` / `capability`, see
// `nav-visibility.ts`). Items with neither stay visible to every member. The
// app currently restricts back-office surfaces inside Settings, not the
// everyday scientific work listed here, so none is hidden today; the shell
// filters with the same predicate so a future restricted item only has to
// declare its roles.
export type NavItem = NavVisibility & {
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

export const primaryNav: NavItem[] = [
  { label: 'Home', icon: 'home', link: { to: '/' } },
  { label: 'Inbox', icon: 'inbox', link: { to: '/inbox' } },
  // Opens with the filter builder showing: the way to ask a question by
  // type, project, owner or field rather than by words alone.
  {
    label: 'Search',
    icon: 'search',
    link: { to: '/search', search: { builder: true } },
  },
  { label: 'Schedule', icon: 'calendar', link: { to: '/schedule' } },
]

export const recordNav: NavItem[] = [
  { label: 'Projects', icon: 'folder', link: { to: '/projects' } },
  { label: 'Experiments', icon: 'flask', link: { to: '/experiments' } },
  { label: 'Protocols', icon: 'protocol', link: { to: '/protocols' } },
  { label: 'Reports', icon: 'report', link: { to: '/reports' } },
  { label: 'Templates', icon: 'template', link: { to: '/templates' } },
  { label: 'Samples', icon: 'tube', link: { to: '/samples' } },
  { label: 'Materials', icon: 'box', link: { to: '/materials' } },
  // An instrument is an everyday bench object here — it has a stable identifier,
  // a status, qualification and calibration dates and bookings, and the Schedule
  // and reading flows name one — so its registry sits with the other record
  // kinds. The design build filed `/instruments` under Settings instead
  // (`sheetbase-app-ui-only/src/components/shell/app-shell.tsx:23`), which left
  // the registry reachable only from a role-gated Settings tab; the parser and
  // connection *configuration* stays there (`/settings/instruments`).
  { label: 'Instruments', icon: 'plug', link: { to: '/instruments' } },
  { label: 'Datasets', icon: 'table', link: { to: '/datasets' } },
  { label: 'Analysis', icon: 'chart', link: { to: '/analysis' } },
  { label: 'Pipelines', icon: 'pipeline', link: { to: '/pipelines' } },
  { label: 'Models', icon: 'schema', link: { to: '/models' } },
]
