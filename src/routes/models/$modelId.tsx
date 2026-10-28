import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
} from '@tanstack/react-router'

import type { Crumb } from '#/components/v3/ui/breadcrumb'
import { PageHeader } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Tabs } from '#/components/v3/ui/tabs'
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
import {
  useRecordModelRecordCount,
  useRecordModelVersionList,
} from '#/components/v3/models/record-model-data'
import { isUuid } from '#/lib/field-value-validation'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** UI port (roadmap-4/ui-app3): the model detail frame. A dataset-schema model
 * (uuid) opens on Fields; a workspace-defined record model (ADR-0051, key)
 * opens on its Records list. Built-in kinds link to their existing surface. */
export const Route = createFileRoute('/models/$modelId')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
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
  // A record's page carries its own header: the model's tabs would sit above
  // a record they do not describe.
  const onRecord = Boolean(
    matchRoute({ to: '/models/$modelId/records/$recordId' }),
  )
  if (onEdit || (onRecord && !isUuid(modelId))) return <Outlet />
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
    // A failed read is not a missing model: say which happened.
    if (definition.isError) {
      return (
        <div className="flex min-w-0 flex-1 flex-col">
          <PageHeader
            trail={[{ label: 'Models', link: { to: '/models' } }]}
            title="Model could not be loaded"
          />
          <div className="px-4 py-6 md:px-6">
            <EmptyState
              icon="warn"
              title="The model definition could not be read"
              description="This model could not be loaded. Check the connection and try again."
              action={
                <Button onClick={() => void definition.refetch()}>
                  Try again
                </Button>
              }
            />
          </div>
        </div>
      )
    }
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Models', link: { to: '/models' } }]}
          title={definition.isLoading ? 'Loading model…' : 'Model not found'}
        />
        {definition.isLoading ? null : (
          <div className="px-4 py-6 md:px-6">
            <EmptyState
              icon="warn"
              title="Model not found"
              description="It may have been removed, or it belongs to another workspace."
              action={
                <Button nativeButton={false} render={<Link to="/models" />}>
                  Back to models
                </Button>
              }
            />
          </div>
        )}
      </div>
    )
  }
  const params = { modelId: m.id }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: 'Models', link: { to: '/models' } },
          { label: m.display_id ?? m.key, mono: true },
        ]}
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
          <Tabs
            mode="url"
            label="Model sections"
            items={[
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
  const recordCount = useRecordModelRecordCount(modelKey)
  const recordVersions = useRecordModelVersionList(model.data?.id)
  const publishedVersion = recordVersions.data?.find(
    (v) => v.lifecycle === 'published',
  )
  const draftVersion = recordVersions.data?.find((v) => v.lifecycle === 'draft')
  const builtIn = useBuiltInModelKind(modelKey)

  const trail: Crumb[] = [{ label: 'Models', link: { to: '/models' } }]
  const m = model.data
  if (m) {
    const params = { modelId: m.key }
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[...trail, { label: m.key, mono: true }]}
          title={m.name}
          meta={
            <>
              <span className="text-fg">
                <Status tone={modelStatus(m.lifecycle).tone}>
                  {modelStatus(m.lifecycle).label}
                </Status>
              </span>
              {draftVersion ? (
                <span>
                  <Status tone="stored">Draft v{draftVersion.version}</Status>
                </span>
              ) : null}
              <span>Record model</span>
              <span>
                ID prefix <span className="mono">{m.identifier_prefix}-</span>
              </span>
            </>
          }
          actions={
            <>
              <Button
                nativeButton={false}
                render={<Link to="/models/$modelId/edit" params={params} />}
              >
                {draftVersion
                  ? `Edit draft v${draftVersion.version}`
                  : 'Edit fields'}
              </Button>
            </>
          }
          tabs={
            <Tabs
              mode="url"
              label="Model record sections"
              items={[
                {
                  label: 'Records',
                  count: recordCount.data,
                  link: {
                    to: '/models/$modelId/records',
                    params,
                  },
                },
                {
                  label: 'Fields',
                  count: publishedVersion?.definition.fields.length,
                  link: {
                    to: '/models/$modelId/fields',
                    params,
                  },
                },
                {
                  label: 'Versions',
                  count: recordVersions.data?.filter(
                    (v) => v.lifecycle === 'published',
                  ).length,
                  link: {
                    to: '/models/$modelId/versions',
                    params,
                  },
                },
                {
                  label: 'Rules',
                  link: {
                    to: '/models/$modelId/rules',
                    params,
                  },
                },
                {
                  label: 'Relations',
                  link: {
                    to: '/models/$modelId/relations',
                    params,
                  },
                },
                {
                  label: 'Usage',
                  link: {
                    to: '/models/$modelId/usage',
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
        <PageHeader trail={trail} title="Loading model…" />
      </div>
    )
  }

  const kind = builtIn.data
  if (kind) {
    const surface = BUILT_IN_KIND_SURFACES[modelKey]
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={trail}
          title={kind.label}
          meta={<span>Built-in model kind</span>}
        />
        <div className="px-4 py-6 md:px-6">
          <EmptyState
            icon="table"
            title={`${kind.label} is a built-in model`}
            description="Built-in kinds keep their own surface. Open it below; workspace-defined models show their records here."
            action={
              <Button
                variant="primary"
                nativeButton={false}
                render={<Link to={surface?.to ?? '/models'} />}
              >
                {surface ? `Open ${surface.label}` : 'Back to Models'}
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  // Neither registry returned a row; a failed read cannot be reported as a
  // model that does not exist.
  if (model.isError || builtIn.isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader trail={trail} title="Model could not be loaded" />
        <div className="px-4 py-6 md:px-6">
          <EmptyState
            icon="warn"
            title={`Model “${modelKey}” could not be read`}
            description="Could not check this record type. Check the connection and try again."
            action={
              <Button
                onClick={() => {
                  void model.refetch()
                  void builtIn.refetch()
                }}
              >
                Try again
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader trail={trail} title="Model not found" />
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="table"
          title={`No model “${modelKey}”`}
          description="This workspace has no record model with that key, and it is not a built-in kind."
          action={
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link to="/models" />}
            >
              Back to Models
            </Button>
          }
        />
      </div>
    </div>
  )
}
