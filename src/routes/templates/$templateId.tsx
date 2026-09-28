import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
} from '@tanstack/react-router'

import { PageHeader } from '#/components/v3/ui/layout'
import { LinkTabs } from '#/components/v3/projects/search-tabs'
import { Status } from '#/components/v3/ui/status'
import {
  templateLifecycle,
  useTemplate,
  useTemplateVersions,
} from '#/components/v3/templates/templates-data'

/** UI port (roadmap-4/ui-app3): the template detail frame. The Sections view
 * reads the selected version's stored configuration; Update takes a new version
 * into a notebook that was made from an older one. */
export const Route = createFileRoute('/templates/$templateId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: TemplateLayout,
})

function TemplateLayout() {
  const { templateId } = Route.useParams()
  const matchRoute = useMatchRoute()
  const onUpdate = Boolean(
    matchRoute({ to: '/templates/$templateId/update', fuzzy: true }),
  )
  const template = useTemplate(templateId)
  const versions = useTemplateVersions(templateId)

  const t = template.data
  if (onUpdate) return <Outlet />
  if (!t) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <Link to="/templates" className="text-link">
              Templates
            </Link>
          }
          title={
            template.isLoading ? 'Loading template…' : 'Template not found'
          }
        />
      </div>
    )
  }
  const params = { templateId: t.id }
  const lifecycle = templateLifecycle(t.lifecycle)
  const list = versions.data ?? []
  const latest = [...list].sort((a, b) => b.version - a.version).at(0)
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        crumbs={
          <>
            <Link to="/templates" className="text-link">
              Templates
            </Link>{' '}
            / <span className="mono">{t.key}</span>
          </>
        }
        title={t.name}
        meta={
          <>
            <span className="text-fg">
              <Status tone={lifecycle.tone}>{lifecycle.label}</Status>
            </span>
            <span>Notebook template</span>
            <span className="max-lg:hidden">
              {latest ? `Latest v${latest.version}` : 'No version yet'}
            </span>
          </>
        }
        tabs={
          <LinkTabs
            tabs={[
              {
                label: 'Sections',
                count: latest?.configuration.placements.length,
                link: {
                  to: '/templates/$templateId',
                  params,
                  activeOptions: { exact: true },
                },
              },
              {
                label: 'Versions',
                count: versions.data?.length,
                link: { to: '/templates/$templateId/versions', params },
              },
              {
                label: 'In use',
                link: { to: '/templates/$templateId/in-use', params },
              },
            ]}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
