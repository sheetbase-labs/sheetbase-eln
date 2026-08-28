/**
 * AUTO-03 — Pipeline run detail (`/pipelines/runs/$runId`).
 */
import { createFileRoute, redirect } from '@tanstack/react-router'

import { useShell } from '#/components/app-shell'
import { PipelineRunDetail } from '#/components/pipelines/pipeline-run-detail'
import { PageHeader } from '#/components/ui'
import { createDataClient } from '#/lib/data-client'

export const Route = createFileRoute('/pipelines/runs/$runId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: PipelineRunRoute,
})

const dataClient = createDataClient()

function PipelineRunRoute() {
  const { runId } = Route.useParams()
  const { context } = Route.useRouteContext()

  useShell({
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: {
        name: context.user.name,
        email: context.user.email,
        role: context.workspace?.role,
      },
    },
    breadcrumbs: [
      { label: 'Home', to: '/' },
      { label: 'Pipelines', to: '/pipelines' },
      { label: `Run ${runId.slice(0, 8)}` },
    ],
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-4">
        <PageHeader
          eyebrow="Pipeline run"
          title={`Run ${runId.slice(0, 8)}`}
          description="Deterministic execution record: pinned inputs, produced outputs and the append-only stage log."
          className="border-0 pb-4"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-8">
        <PipelineRunDetail dataClient={dataClient} runId={runId} />
      </div>
    </div>
  )
}
