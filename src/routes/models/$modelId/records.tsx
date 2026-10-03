import { Outlet, createFileRoute } from '@tanstack/react-router'

/**
 * MDL-04 — layout for a workspace model's records. The list is the index
 * (`/models/$modelId/records`); `new` and `$recordId` render over it.
 */
export const Route = createFileRoute('/models/$modelId/records')({
  component: RecordModelRecordsLayout,
})

function RecordModelRecordsLayout() {
  return <Outlet />
}
