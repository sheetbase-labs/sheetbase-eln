import { Navigate, createFileRoute } from '@tanstack/react-router'

/**
 * R5-SURF-01 — the dataset detail index.
 *
 * Imports, Used by and History are selected by the `view` search parameter on
 * the parent dataset detail route (the layout renders the panel and skips this
 * Outlet), so each is a linkable, reloadable URL (`/datasets/<id>?view=imports`).
 * With no view this is the design's default: redirect to Snapshots, exactly as
 * the frame did before the tabs existed.
 */
export const Route = createFileRoute('/datasets/$datasetId/')({
  component: DatasetDetailIndex,
})

function DatasetDetailIndex() {
  const { datasetId } = Route.useParams()
  return (
    <Navigate
      to="/datasets/$datasetId/snapshots"
      params={{ datasetId }}
      replace
    />
  )
}
