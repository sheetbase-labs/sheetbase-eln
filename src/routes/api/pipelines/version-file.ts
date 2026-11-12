import { createFileRoute } from '@tanstack/react-router'
import { handleVersionFile } from '#/lib/pipeline-version-file.server'

/**
 * POST /api/pipelines/version-file — read a version file (Advanced mode) into a
 * configuration with every mistake on its line, or write a configuration out as
 * its file. Saves nothing. See docs/subsystems/pipelines.md, "The version file".
 */
export const Route = createFileRoute('/api/pipelines/version-file')({
  server: {
    handlers: {
      POST: ({ request }) => handleVersionFile(request),
    },
  },
})
