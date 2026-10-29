import { useState } from 'react'
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
import { BuiltInModelLayout } from '#/components/v3/models/built-in-model-layout'
import {
  BasedOnDialog,
  NewSubtypeDialog,
  SubtypeOf,
  SubtypesList,
  useTypedObjects,
} from '#/components/v3/models/model-subtype-ui'
import {
  NewTableSubtypeDialog,
  TableBasedOnDialog,
  TableSubtypeOf,
  TableSubtypesList,
} from '#/components/v3/models/dataset-subtype-ui'
import { builtInModel } from '#/lib/built-in-models'
import { hasCapability } from '#/lib/capability'
import { isUuid } from '#/lib/field-value-validation'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { rich, t } from '#/copy'

/** UI port (roadmap-4/ui-app3): the model detail frame. A dataset-schema model
 * (uuid) opens on Fields; a workspace-defined record model (ADR-0051, key)
 * opens on its Records list; a built-in model (Experiment, Sample…) opens on
 * the Fields a workspace adds to it. */
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
  const { context } = Route.useRouteContext()
  if (onEdit || (onRecord && !isUuid(modelId))) return <Outlet />
  const builtIn = builtInModel(modelId)
  if (builtIn)
    return (
      <BuiltInModelLayout
        model={builtIn}
        role={context.workspace?.role}
        workspaceId={context.workspace?.id ?? null}
      />
    )
  // A dataset-schema model is addressed by uuid; a workspace record model by
  // its stable key. The two registries never share an identifier.
  return isUuid(modelId) ? (
    <DatasetModelLayout modelId={modelId} role={context.workspace?.role} />
  ) : (
    <RecordModelLayout
      modelKey={modelId}
      role={context.workspace?.role}
      workspaceId={context.workspace?.id ?? null}
    />
  )
}

function DatasetModelLayout({
  modelId,
  role,
}: {
  modelId: string
  role: string | null | undefined
}) {
  const definition = useModelDefinition(modelId)
  const canEdit = hasCapability(role, 'schema.edit')
  const [subtypeOpen, setSubtypeOpen] = useState(false)
  const [basedOnOpen, setBasedOnOpen] = useState(false)
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
            trail={[
              {
                label: t('library.models.overview.models'),
                link: { to: '/models' },
              },
            ]}
            title={t('library.models.overview.modelCouldNotBeLoaded')}
          />
          <div className="px-4 py-6 md:px-6">
            <EmptyState
              icon="warn"
              title={t('library.models.overview.theModelDefinitionCouldNot')}
              description={t('library.models.overview.thisModelCouldNotBe')}
              action={
                <Button onClick={() => void definition.refetch()}>
                  {t('common.actions.tryAgain')}
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
          trail={[
            {
              label: t('library.models.overview.models'),
              link: { to: '/models' },
            },
          ]}
          title={
            definition.isLoading
              ? t('library.models.overview.loadingModel')
              : t('library.models.overview.modelNotFound')
          }
        />
        {definition.isLoading ? null : (
          <div className="px-4 py-6 md:px-6">
            <EmptyState
              icon="warn"
              title={t('library.models.overview.modelNotFound')}
              description={t('library.models.overview.itMayHaveBeenRemoved')}
              action={
                <Button nativeButton={false} render={<Link to="/models" />}>
                  {t('library.models.overview.backToModels')}
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
          {
            label: t('library.models.overview.models'),
            link: { to: '/models' },
          },
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
            <span>{t('library.models.overview.key', { key: m.key })}</span>
            <TableSubtypeOf id={m.id} />
            <span className="max-lg:hidden">
              {latest
                ? t('library.models.overview.versionV', {
                    version: latest.version,
                  })
                : t('library.models.overview.noVersionYet')}
            </span>
            <TableSubtypesList id={m.id} />
          </>
        }
        actions={
          <>
            {canEdit ? (
              <>
                <Button onClick={() => setBasedOnOpen(true)}>
                  {t('library.models.overview.basedOn')}
                </Button>
                <Button onClick={() => setSubtypeOpen(true)}>
                  {t('library.models.overview.newSubtype')}
                </Button>
              </>
            ) : null}
            <Button
              variant="primary"
              icon="edit"
              nativeButton={false}
              render={<Link to="/models/$modelId/edit" params={params} />}
            >
              {t('library.models.overview.editModel')}
            </Button>
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label={t('library.models.overview.modelSections')}
            items={[
              {
                label: t('library.models.overview.fields'),
                count: fields.data?.length,
                link: {
                  to: '/models/$modelId/fields',
                  params,
                },
              },
              {
                label: t('library.models.overview.versions'),
                count: versions.data?.length,
                link: {
                  to: '/models/$modelId/versions',
                  params,
                },
              },
              {
                label: t('library.models.overview.datasets'),
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
      <NewTableSubtypeDialog
        open={subtypeOpen}
        onOpenChange={setSubtypeOpen}
        parent={m}
      />
      {basedOnOpen ? (
        <TableBasedOnDialog open onOpenChange={setBasedOnOpen} table={m} />
      ) : null}
    </div>
  )
}

function RecordModelLayout({
  modelKey,
  role,
  workspaceId,
}: {
  modelKey: string
  role: string | null | undefined
  workspaceId: string | null
}) {
  const model = useWorkspaceRecordModel(modelKey)
  const canEdit = hasCapability(role, 'schema.edit')
  const [subtypeOpen, setSubtypeOpen] = useState(false)
  const [basedOnOpen, setBasedOnOpen] = useState(false)
  const recordCount = useRecordModelRecordCount(modelKey)
  const typed = useTypedObjects(modelKey)
  const recordVersions = useRecordModelVersionList(model.data?.id)
  const publishedVersion = recordVersions.data?.find(
    (v) => v.lifecycle === 'published',
  )
  const draftVersion = recordVersions.data?.find((v) => v.lifecycle === 'draft')
  const builtIn = useBuiltInModelKind(modelKey)

  const trail: Crumb[] = [
    { label: t('library.models.overview.models'), link: { to: '/models' } },
  ]
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
                  <Status tone="stored">
                    {t('library.models.overview.draftV', {
                      version: draftVersion.version,
                    })}
                  </Status>
                </span>
              ) : null}
              {m.parent_key ? (
                <SubtypeOf modelKey={m.key} />
              ) : (
                <span>{t('library.models.overview.recordModel')}</span>
              )}
              <span>
                {rich('library.models.overview.idPrefix', {
                  identifierPrefix: m.identifier_prefix,
                  span: (text) => <span className="mono">{text}</span>,
                })}
              </span>
              <SubtypesList modelKey={m.key} />
            </>
          }
          actions={
            <>
              {canEdit ? (
                <>
                  <Button onClick={() => setBasedOnOpen(true)}>
                    {t('library.models.overview.basedOn')}
                  </Button>
                  <Button onClick={() => setSubtypeOpen(true)}>
                    {t('library.models.overview.newSubtype')}
                  </Button>
                </>
              ) : null}
              <Button
                nativeButton={false}
                render={<Link to="/models/$modelId/edit" params={params} />}
              >
                {draftVersion
                  ? t('library.models.overview.editDraftV', {
                      version: draftVersion.version,
                    })
                  : t('library.models.overview.editFields')}
              </Button>
            </>
          }
          tabs={
            <Tabs
              mode="url"
              label={t('library.models.overview.modelRecordSections')}
              items={[
                {
                  label: t('library.models.overview.records'),
                  count: m.parent_key
                    ? typed.objects.data?.length
                    : recordCount.data,
                  link: {
                    to: '/models/$modelId/records',
                    params,
                  },
                },
                {
                  label: t('library.models.overview.fields'),
                  count: publishedVersion?.definition.fields.length,
                  link: {
                    to: '/models/$modelId/fields',
                    params,
                  },
                },
                {
                  label: t('library.models.overview.versions'),
                  count: recordVersions.data?.filter(
                    (v) => v.lifecycle === 'published',
                  ).length,
                  link: {
                    to: '/models/$modelId/versions',
                    params,
                  },
                },
                {
                  label: t('library.models.overview.rules'),
                  link: {
                    to: '/models/$modelId/rules',
                    params,
                  },
                },
                {
                  label: t('library.models.overview.relations'),
                  link: {
                    to: '/models/$modelId/relations',
                    params,
                  },
                },
                {
                  label: t('library.models.overview.usage'),
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
        <NewSubtypeDialog
          open={subtypeOpen}
          onOpenChange={setSubtypeOpen}
          workspaceId={workspaceId}
          parentKey={m.key}
          parentName={m.name}
        />
        {basedOnOpen ? (
          <BasedOnDialog open onOpenChange={setBasedOnOpen} model={m} />
        ) : null}
      </div>
    )
  }

  if (model.isLoading || builtIn.isLoading) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={trail}
          title={t('library.models.overview.loadingModel')}
        />
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
          meta={<span>{t('library.models.overview.builtInModelKind')}</span>}
        />
        <div className="px-4 py-6 md:px-6">
          <EmptyState
            icon="table"
            title={t('library.models.overview.isABuiltInModel', {
              label: kind.label,
            })}
            description={t('library.models.overview.builtInKindsKeepTheir')}
            action={
              <Button
                variant="primary"
                nativeButton={false}
                render={<Link to={surface?.to ?? '/models'} />}
              >
                {surface
                  ? t('library.models.overview.open', { label: surface.label })
                  : t('library.models.overview.backToModels2')}
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
        <PageHeader
          trail={trail}
          title={t('library.models.overview.modelCouldNotBeLoaded')}
        />
        <div className="px-4 py-6 md:px-6">
          <EmptyState
            icon="warn"
            title={t('library.models.overview.modelCouldNotBeRead', {
              modelKey,
            })}
            description={t('library.models.overview.couldNotCheckThisRecord')}
            action={
              <Button
                onClick={() => {
                  void model.refetch()
                  void builtIn.refetch()
                }}
              >
                {t('common.actions.tryAgain')}
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
        trail={trail}
        title={t('library.models.overview.modelNotFound')}
      />
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="table"
          title={t('library.models.overview.noModel', { modelKey })}
          description={t('library.models.overview.thisWorkspaceHasNoRecord')}
          action={
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link to="/models" />}
            >
              {t('library.models.overview.backToModels2')}
            </Button>
          }
        />
      </div>
    </div>
  )
}
