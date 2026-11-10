/** Where the not-found screen sends someone next: a section route with its label. */
import type { LinkProps } from '@tanstack/react-router'

import { t } from '#/copy'

interface Section {
  link: LinkProps
  label: string
}

/** The section routes the not-found screen can return to, keyed by path segment. */
interface SectionTable {
  [segment: string]: Section
}

// The first path segment a URL sits under, and the section route to return to.
// Only real section routes are listed so the "back" link can itself never 404.
const SECTIONS: SectionTable = {
  inbox: { link: { to: '/inbox' }, label: t('settings.shell.notFound.inbox') },
  schedule: {
    link: { to: '/schedule' },
    label: t('settings.shell.notFound.schedule'),
  },
  projects: {
    link: { to: '/projects' },
    label: t('settings.shell.notFound.projects'),
  },
  experiments: {
    link: { to: '/experiments' },
    label: t('settings.shell.notFound.experiments'),
  },
  protocols: {
    link: { to: '/protocols' },
    label: t('settings.shell.notFound.protocols'),
  },
  templates: {
    link: { to: '/templates' },
    label: t('settings.shell.notFound.templates'),
  },
  samples: {
    link: { to: '/samples' },
    label: t('settings.shell.notFound.samples'),
  },
  materials: {
    link: { to: '/materials' },
    label: t('settings.shell.notFound.materials'),
  },
  datasets: {
    link: { to: '/datasets' },
    label: t('settings.shell.notFound.datasets'),
  },
  analysis: {
    link: { to: '/analysis' },
    label: t('settings.shell.notFound.analysis'),
  },
  pipelines: {
    link: { to: '/pipelines' },
    label: t('settings.shell.notFound.pipelines'),
  },
  models: {
    link: { to: '/models' },
    label: t('settings.shell.notFound.models'),
  },
  instruments: {
    link: { to: '/instruments' },
    label: t('settings.shell.notFound.instruments'),
  },
  settings: {
    link: { to: '/settings' },
    label: t('settings.shell.notFound.settings'),
  },
  help: { link: { to: '/help' }, label: t('settings.shell.notFound.help') },
}

/** The section a pathname implies, for the not-found screen's next step. */
export function sectionForPath(pathname: string): Section | null {
  const segment = pathname.split('/').filter(Boolean)[0]

  if (!segment) return null

  return SECTIONS[segment] ?? null
}
