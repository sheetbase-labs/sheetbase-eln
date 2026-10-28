import {
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
  Link,
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
  useTemplateUsers,
} from '#/components/v3/templates/templates-data'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { formatDate } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'

/** UI port (roadmap-4/ui-app3): the template detail frame. The Sections view
 * reads the selected version's stored configuration; Update takes a new version
 * into a notebook that was made from an older one. */
export const Route = createFileRoute('/templates/$templateId')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: TemplateLayout,
})

function TemplateLayout() {
  const { templateId } = Route.useParams()
  const matchRoute = useMatchRoute()
  const onVersions = Boolean(
    matchRoute({ to: '/templates/$templateId/versions', fuzzy: true }),
  )
  const onUpdate = Boolean(
    matchRoute({ to: '/templates/$templateId/update', fuzzy: true }),
  )
  const template = useTemplate(templateId)
  const versions = useTemplateVersions(templateId)
  const versionList = versions.data ?? []
  const inUse = useTemplateUsers(versionList.map((v) => v.id))
  const owner = useUserNames(
    template.data?.createdByUserId ? [template.data.createdByUserId] : [],
  )

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
  // The Sections view opens the newest version (an open draft, else the
  // current published one), so the badge counts that version's placements.
  const shown = latest
  const published = publishedTemplateVersion(list)
  const openDraft = latest?.lifecycle === 'draft' ? latest : null
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: 'Templates', link: { to: '/templates' } },
          { label: t.displayId ?? t.key, mono: true },
        ]}
        title={t.name}
        actions={
          <div className="flex items-center gap-2">
            {openDraft && onVersions ? (
              <Button
                icon="edit"
                render={<Link to="/templates/$templateId" params={params} />}
              >
                Open draft v{openDraft.version}
              </Button>
            ) : null}
            <UseTemplateDialog
              templateName={t.name}
              version={published ?? null}
            />
          </div>
        }
        meta={
          <>
            <span className="text-fg">
              <Status tone={lifecycle.tone}>{lifecycle.label}</Status>
            </span>
            <span>Notebook template</span>
            {published ? (
              <span className="text-fg">
                <Status tone="progress">Current v{published.version}</Status>
              </span>
            ) : null}
            {openDraft ? (
              <span className="text-fg">
                <Status tone="draft">Draft v{openDraft.version}</Status>
              </span>
            ) : null}
            <span className="max-lg:hidden">
              {published?.publishedAt
                ? `Published v${published.version} ${formatDate(published.publishedAt)}`
                : null}
            </span>
            {t.createdByUserId ? (
              <span className="max-lg:hidden">
                Owner {owner.userLabel(t.createdByUserId)}
              </span>
            ) : null}
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
                count: inUse.data?.length,
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
