import { Link, useLocation, useMatches } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'

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
  inbox: { link: { to: '/inbox' }, label: 'Inbox' },
  schedule: { link: { to: '/schedule' }, label: 'Schedule' },
  projects: { link: { to: '/projects' }, label: 'Projects' },
  experiments: { link: { to: '/experiments' }, label: 'Experiments' },
  protocols: { link: { to: '/protocols' }, label: 'Protocols' },
  templates: { link: { to: '/templates' }, label: 'Templates' },
  samples: { link: { to: '/samples' }, label: 'Samples' },
  materials: { link: { to: '/materials' }, label: 'Materials' },
  datasets: { link: { to: '/datasets' }, label: 'Datasets' },
  analysis: { link: { to: '/analysis' }, label: 'Analysis' },
  pipelines: { link: { to: '/pipelines' }, label: 'Pipelines' },
  models: { link: { to: '/models' }, label: 'Models' },
  instruments: { link: { to: '/instruments' }, label: 'Instruments' },
  settings: { link: { to: '/settings' }, label: 'Settings' },
  help: { link: { to: '/help' }, label: 'Help' },
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
          'Not found in this workspace'
        ) : (
          <span className="mono text-body font-normal">{pathname}</span>
        )
      }
      className="pt-3"
      body={
        nested
          ? 'There’s nothing at this part of the record, or it was removed.'
          : 'There’s nothing at this address, or the record isn’t in this workspace.'
      }
    >
      {section ? (
        <Button
          variant="primary"
          nativeButton={false}
          render={<Link {...section.link} />}
        >
          Back to {section.label}
        </Button>
      ) : (
        <Button variant="primary" nativeButton={false} render={<Link to="/" />}>
          Go to Home
        </Button>
      )}
      <Button
        variant="secondary"
        nativeButton={false}
        render={<Link to="/search" search={{}} />}
      >
        Search
      </Button>
    </EmptyState>
  )
  if (nested)
    return <div className="flex-1 overflow-auto px-8 py-2">{body}</div>
  return (
    <div className="flex-1 overflow-auto px-8 py-6">
      <h1 className="text-title">Not found</h1>
      {body}
    </div>
  )
}
