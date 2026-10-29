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
import { t } from '#/copy'

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

  const item = template.data
  if (onUpdate) return <Outlet />
  if (template.isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('library.templates.detail.templates'),
              link: { to: '/templates' },
            },
          ]}
          title={t('library.templates.detail.templateCouldNotBeLoaded')}
        />
        <div className="px-4 py-4 md:px-6">
          <Notice
            tone="bad"
            title={t('library.templates.detail.couldNotLoadThisTemplate')}
            action={
              <Button size="sm" onClick={() => void template.refetch()}>
                {t('common.actions.tryAgain')}
              </Button>
            }
          >
            {t('library.templates.detail.theTemplateCouldNotBe')}
          </Notice>
        </div>
      </div>
    )
  }
  if (!item) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('library.templates.detail.templates'),
              link: { to: '/templates' },
            },
          ]}
          title={
            template.isLoading
              ? t('library.templates.detail.loadingTemplate')
              : t('library.templates.detail.templateNotFound')
          }
        />
      </div>
    )
  }
  const params = { templateId: item.id }
  const lifecycle = templateLifecycle(item.lifecycle)
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
          {
            label: t('library.templates.detail.templates'),
            link: { to: '/templates' },
          },
          { label: item.displayId ?? item.key, mono: true },
        ]}
        title={item.name}
        actions={
          <div className="flex items-center gap-2">
            {openDraft && onVersions ? (
              <Button
                icon="edit"
                render={<Link to="/templates/$templateId" params={params} />}
              >
                {t('library.templates.detail.openDraftV', {
                  version: openDraft.version,
                })}
              </Button>
            ) : null}
            <UseTemplateDialog
              templateName={item.name}
              version={published ?? null}
            />
          </div>
        }
        meta={
          <>
            <span className="text-fg">
              <Status tone={lifecycle.tone}>{lifecycle.label}</Status>
            </span>
            <span>{t('library.templates.detail.notebookTemplate')}</span>
            {published ? (
              <span className="text-fg">
                <Status tone="progress">
                  {t('library.templates.detail.currentV', {
                    version: published.version,
                  })}
                </Status>
              </span>
            ) : null}
            {openDraft ? (
              <span className="text-fg">
                <Status tone="draft">
                  {t('library.templates.detail.draftV', {
                    version: openDraft.version,
                  })}
                </Status>
              </span>
            ) : null}
            <span className="max-lg:hidden">
              {published?.publishedAt
                ? t('library.templates.detail.publishedV', {
                    version: published.version,
                    publishedAt: formatDate(published.publishedAt),
                  })
                : null}
            </span>
            {item.createdByUserId ? (
              <span className="max-lg:hidden">
                {t('library.templates.detail.owner', {
                  owner: owner.userLabel(item.createdByUserId),
                })}
              </span>
            ) : null}
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label={t('library.templates.detail.templateSections')}
            items={[
              {
                label: t('library.templates.detail.sections'),
                count: shown?.configuration.placements.length,
                link: {
                  to: '/templates/$templateId',
                  params,
                  activeOptions: { exact: true },
                },
              },
              {
                label: t('library.templates.detail.versions'),
                count: versions.data?.length,
                link: { to: '/templates/$templateId/versions', params },
              },
              {
                label: t('library.templates.detail.inUse'),
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
