import { createFileRoute } from '@tanstack/react-router'
import { getAppSession } from '#/lib/auth'
import { getPythonRuntime } from '#/lib/pipeline-python.server'

export const Route = createFileRoute('/api/pipelines/runtime')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await getAppSession(request.headers)))
          return new Response(null, { status: 401 })
        try {
          return Response.json({
            available: true,
            runtime: await getPythonRuntime(),
          })
        } catch {
          return Response.json({
            available: false,
            message:
              'Python is not available yet. Ask your administrator to connect a Python runner.',
          })
        }
      },
    },
  },
})
