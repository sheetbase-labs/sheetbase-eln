import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
} from '@tanstack/react-router'

import { PageHeader } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { LinkTabs } from '#/components/v3/projects/search-tabs'
import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import {
  BUILT_IN_KIND_SURFACES,
  modelStatus,
  useBuiltInModelKind,
  useModelDefinition,
  useModelDatasets,
  useModelFields,
  useModelVersions,
  useWorkspaceRecordModel,
} from '#/components/v3/models/models-data'
import { isUuid } from '#/lib/field-value-validation'

/** UI port (roadmap-4/ui-app3): the model detail frame. A dataset-schema model
 * (uuid) opens on Fields; a workspace-defined record model (ADR-0051, key)
 * opens on its Records list. Built-in kinds link to their existing surface. */
export const Route = createFileRoute('/models/$modelId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ModelLayout,
})

function ModelLayout() {
  const { modelId } = Route.useParams()
  const matchRoute = useMatchRoute()
  const onEdit = Boolean(
    matchRoute({ to: '/models/$modelId/edit', fuzzy: true }),
  )
  if (onEdit) return <Outlet />
  // A dataset-schema model is addressed by uuid; a workspace record model by
  // its stable key. The two registries never share an identifier.
  return isUuid(modelId) ? (
    <DatasetModelLayout modelId={modelId} />
  ) : (
    <RecordModelLayout modelKey={modelId} />
  )
}

function DatasetModelLayout({ modelId }: { modelId: string }) {
  const definition = useModelDefinition(modelId)
  const versions = useModelVersions(modelId)
  const latest = versions.data?.[0]
  const fields = useModelFields(latest?.id)
  const versionIds = (versions.data ?? []).map((v) => v.id)
  const datasets = useModelDatasets(versionIds)

  const m = definition.data
  if (!m) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <Link to="/models" className="text-link">
              Models
            </Link>
          }
          title={definition.isLoading ? 'Loading model…' : 'Model not found'}
        />
      </div>
    )
  }
  const params = { modelId: m.id }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        crumbs={
          <>
            <Link to="/models" className="text-link">
              Models
            </Link>{' '}
            / <span className="mono">{m.key}</span>
          </>
        }
        title={m.name}
        meta={
          <>
            <span className="text-fg">
              <Status tone={modelStatus(m.lifecycle).tone}>
                {modelStatus(m.lifecycle).label}
              </Status>
            </span>
            <span>Key {m.key}</span>
            <span className="max-lg:hidden">
              {latest ? `Version v${latest.version}` : 'No version yet'}
            </span>
          </>
        }
        actions={
          <Button
            variant="primary"
            icon="edit"
            nativeButton={false}
            render={<Link to="/models/$modelId/edit" params={params} />}
          >
            Edit model
          </Button>
        }
        tabs={
          <LinkTabs
            tabs={[
              {
                label: 'Fields',
                count: fields.data?.length,
                link: {
                  to: '/models/$modelId/fields',
                  params,
                },
              },
              {
                label: 'Versions',
                count: versions.data?.length,
                link: {
                  to: '/models/$modelId/versions',
                  params,
                },
              },
              {
                label: 'Datasets',
                count: datasets.data?.length,
                link: {
                  to: '/models/$modelId/datasets',
                  params,
                },
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

function RecordModelLayout({ modelKey }: { modelKey: string }) {
  const model = useWorkspaceRecordModel(modelKey)
  const builtIn = useBuiltInModelKind(modelKey)

  const crumbs = (
    <Link to="/models" className="text-link">
      Models
    </Link>
  )
  const m = model.data
  if (m) {
    const params = { modelId: m.key }
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <>
              {crumbs} / <span className="mono">{m.key}</span>
            </>
          }
          title={m.name}
          meta={
            <>
              <span className="text-fg">
                <Status tone={modelStatus(m.lifecycle).tone}>
                  {modelStatus(m.lifecycle).label}
                </Status>
              </span>
              <span>Record model</span>
              <span>
                ID prefix <span className="mono">{m.identifier_prefix}-</span>
              </span>
            </>
          }
          tabs={
            <LinkTabs
              tabs={[
                {
                  label: 'Records',
                  link: {
                    to: '/models/$modelId/records',
                    params,
                  },
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

  if (model.isLoading || builtIn.isLoading) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader crumbs={crumbs} title="Loading model…" />
      </div>
    )
  }

  const kind = builtIn.data
  if (kind) {
    const surface = BUILT_IN_KIND_SURFACES[modelKey]
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={crumbs}
          title={kind.label}
          meta={<span>Built-in model kind</span>}
        />
        <div className="px-4 py-6 md:px-6">
          <EmptyState
            icon="table"
            title={`${kind.label} is a built-in model`}
            body="Built-in kinds keep their own surface. Open it from the link below; workspace-defined models show their records here."
          >
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link to={surface?.to ?? '/models'} />}
            >
              {surface ? `Open ${surface.label}` : 'Back to Models'}
            </Button>
          </EmptyState>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader crumbs={crumbs} title="Model not found" />
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="table"
          title={`No model “${modelKey}”`}
          body="This workspace has no record model with that key, and it is not a built-in kind."
        >
          <Button
            variant="primary"
            nativeButton={false}
            render={<Link to="/models" />}
          >
            Back to Models
          </Button>
        </EmptyState>
      </div>
    </div>
  )
}
