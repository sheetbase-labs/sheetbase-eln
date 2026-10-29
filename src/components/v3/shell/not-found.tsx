import { Link, useLocation, useMatches } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { t } from '#/copy'

// Record layouts that already render a page header (and its h1) above their
// tabs. Inside one of these the screen renders body-only, so the record's own
// header is never duplicated. These are the ELN's file-route ids.
const LAYOUTS = [
  '/experiments/$expId',
  '/datasets/$datasetId',
  '/models/$modelId',
  '/samples/$sampleId',
  '/projects/$projectId',
  '/pipelines/$pipelineId',
  '/templates/$templateId',
]

interface Section {
  link: LinkProps
  label: string
}

// The first path segment a URL sits under, and the section route to return to.
// Only real section routes are listed so the "back" link can itself never 404.
const SECTIONS: Record<string, Section> = {
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

// Unknown route or an ID that isn't in this workspace. Inside a record layout
// it renders without its own h1, since the layout already shows one.
export function NotFound() {
  const { pathname } = useLocation()
  const nested = useMatches().some(
    (m) => LAYOUTS.includes(m.routeId) && m.status === 'success',
  )
  const section = sectionForPath(pathname)
  const body = (
    <EmptyState
      icon="search"
      title={
        nested ? (
          t('settings.shell.notFound.foundWorkspace')
        ) : (
          <span className="mono text-body font-normal">{pathname}</span>
        )
      }
      className="pt-3"
      description={
        nested
          ? t('settings.shell.notFound.nothingPartRecord')
          : t('settings.shell.notFound.nothingAddressRecord')
      }
      action={
        <>
          {section ? (
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link {...section.link} />}
            >
              {t('settings.shell.notFound.back', { label: section.label })}
            </Button>
          ) : (
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link to="/" />}
            >
              {t('settings.shell.notFound.goHome')}
            </Button>
          )}
          <Button
            variant="secondary"
            nativeButton={false}
            render={<Link to="/search" search={{}} />}
          >
            {t('common.actions.search')}
          </Button>
        </>
      }
    />
  )
  if (nested)
    return <div className="flex-1 overflow-auto px-8 py-2">{body}</div>
  return (
    <div className="flex-1 overflow-auto px-8 py-6">
      <h1 className="text-title">{t('common.errors.notFound')}</h1>
      {body}
    </div>
  )
}
