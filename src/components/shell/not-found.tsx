import { Link, useLocation, useMatches } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { t } from '#/copy'
import { sectionForPath } from './not-found-section'

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
