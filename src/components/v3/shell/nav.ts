import type { LinkProps } from '@tanstack/react-router'
import type { IconName } from '#/components/v3/icons'

// Main navigation, ported from sheetbase-app-3 and mapped onto the ELN's route
// tree. Experiments and Protocols appear here once their routes land (the
// capability tasks own them); until then the nav lists only real routes so no
// link 404s.
export type NavItem = {
  label: string
  icon: IconName
  link: LinkProps
  count?: string
}

export const primaryNav: NavItem[] = [
  { label: 'Home', icon: 'home', link: { to: '/' } },
  { label: 'Inbox', icon: 'inbox', link: { to: '/inbox' } },
  { label: 'Schedule', icon: 'calendar', link: { to: '/schedule' } },
]

export const recordNav: NavItem[] = [
  { label: 'Projects', icon: 'folder', link: { to: '/projects' } },
  { label: 'Experiments', icon: 'flask', link: { to: '/experiments' } },
  { label: 'Templates', icon: 'template', link: { to: '/templates' } },
  { label: 'Samples', icon: 'tube', link: { to: '/samples' } },
  { label: 'Materials', icon: 'box', link: { to: '/materials' } },
  { label: 'Datasets', icon: 'table', link: { to: '/datasets' } },
  { label: 'Analysis', icon: 'chart', link: { to: '/analysis' } },
  { label: 'Pipelines', icon: 'pipeline', link: { to: '/pipelines' } },
  { label: 'Models', icon: 'schema', link: { to: '/models' } },
]
