/**
 * Remote jobs: the table a job gives back, or why it failed. The job proves
 * itself with the key made for it alone; there is no session here. A thin
 * wrapper around the handler in src/lib/pipeline-hpc.server.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

const handler = async ({
  request,
  params,
}: {
  request: Request
  params: { jobId: string }
}) => {
  const [{ handleRemoteJobResult }, { realJobCallbackDeps }] =
    await Promise.all([
      import('#/lib/pipeline-hpc.server'),
      import('#/lib/pipeline-hpc-deps.server'),
    ])

  return handleRemoteJobResult(request, params.jobId, realJobCallbackDeps)
}

export const Route = createFileRoute('/api/remote-jobs/$jobId/result')({
  server: { handlers: { POST: handler } },
})
