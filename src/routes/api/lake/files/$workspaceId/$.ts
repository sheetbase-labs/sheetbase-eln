/**
 * Open tables: the Parquet files, for readers with a lake login. Thin wrapper
 * around the testable handler in src/lib/lake/lake-files.server.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

const handler = async ({
  request,
  params,
}: {
  request: Request
  params: { workspaceId: string; _splat?: string }
}) => {
  const { handleLakeFile, realLakeFileDeps } =
    await import('#/lib/lake/lake-files.server')
  return handleLakeFile(
    request,
    params.workspaceId,
    params._splat ?? '',
    realLakeFileDeps(),
  )
}

export const Route = createFileRoute('/api/lake/files/$workspaceId/$')({
  server: {
    handlers: { GET: handler, HEAD: handler },
  },
})
