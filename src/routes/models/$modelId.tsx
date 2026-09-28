import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { PageHeader } from '#/components/v3/ui/layout'
import { LinkTabs } from '#/components/v3/projects/search-tabs'
import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { toast } from '#/components/v3/ui/sonner'
import { createNextDatasetSchemaVersion } from '#/lib/dataset-schema-definition-rpc'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  modelStatus,
  useModelDefinition,
  useModelDatasets,
  useModelFields,
  useModelVersions,
} from '#/components/v3/models/models-data'

/** UI port (roadmap-4/ui-app3): the model detail frame. Fields, Versions and
 * the datasets built on the model are child routes. */
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
  const queryClient = useQueryClient()
  const definition = useModelDefinition(modelId)
  const versions = useModelVersions(modelId)
  const latest = versions.data?.[0]
  const fields = useModelFields(latest?.id)
  const versionIds = (versions.data ?? []).map((v) => v.id)
  const datasets = useModelDatasets(versionIds)

  const newVersion = useMutation({
    mutationFn: () =>
      createNextDatasetSchemaVersion(notebookDataClient, modelId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'models'],
      })
      toast(`Draft v${result.version} started`, {
        description:
          'Add fields and publish it; datasets keep the version they are on.',
      })
    },
    onError: (error: unknown) => {
      toast('Could not start a version', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      })
    },
  })

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
            icon="plus"
            disabled={newVersion.isPending}
            onClick={() => newVersion.mutate()}
          >
            New version
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
