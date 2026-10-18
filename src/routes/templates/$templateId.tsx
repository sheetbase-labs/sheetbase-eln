import {
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
} from '@tanstack/react-router'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { PageHeader } from '#/components/v3/ui/layout'
import { Tabs } from '#/components/v3/ui/tabs'
import { Status } from '#/components/v3/ui/status'
import { UseTemplateDialog } from '#/components/v3/templates/use-template-dialog'
import {
  publishedTemplateVersion,
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
  if (template.isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Templates', link: { to: '/templates' } }]}
          title="Template could not be loaded"
        />
        <div className="px-4 py-4 md:px-6">
          <Notice
            tone="bad"
            title="Could not load this template"
            className="max-w-[520px]"
            action={
              <Button size="sm" onClick={() => void template.refetch()}>
                Try again
              </Button>
            }
          >
            The template could not be read. It may have been retired, or you may
            not have access to it.
          </Notice>
        </div>
      </div>
    )
  }
  if (!t) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Templates', link: { to: '/templates' } }]}
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
  // The Sections view renders the published version when there is one, so the
  // badge counts that version's placements rather than the newest draft's.
  const shown = publishedTemplateVersion(list) ?? latest
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: 'Templates', link: { to: '/templates' } },
          { label: t.key, mono: true },
        ]}
        title={t.name}
        actions={
          <UseTemplateDialog
            templateName={t.name}
            version={publishedTemplateVersion(list) ?? null}
          />
        }
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
          <Tabs
            mode="url"
            label="Template sections"
            items={[
              {
                label: 'Sections',
                count: shown?.configuration.placements.length,
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
