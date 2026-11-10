import {
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
} from '@tanstack/react-router'

import { RecordUnavailable } from '#/components/ui/record-unavailable'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { PageHeader } from '#/components/ui/layout'
import {
  useTemplate,
  useTemplateVersions,
  useTemplateUsers,
} from '#/components/templates/templates-data'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { useUserNames } from '#/lib/user-names'
import { t } from '#/copy'

import { TemplatePageHeader } from './-template-header'

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
        <RecordUnavailable
          query={template}
          what={t('settings.uiKit.recordUnavailable.template')}
          back={{
            to: '/templates',
            label: t('settings.uiKit.recordUnavailable.backToTemplates'),
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <TemplatePageHeader
        item={item}
        versions={versionList}
        versionCount={versions.data?.length}
        inUseCount={inUse.data?.length}
        ownerLabel={owner.userLabel}
        onVersions={onVersions}
      />
      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
