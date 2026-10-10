import { createFileRoute } from '@tanstack/react-router'

import { RecordModelRecords } from '#/components/v3/models/record-model-records'

/**
 * MDL-04.1: the records list of a workspace-defined record model. `$modelId`
 * is the model key (e.g. `cell_bank`); the frame (`/models/$modelId`) resolves
 * the model and falls back to the built-in surface when the key is a built-in
 * kind. Rows are `api.records` where `kind` is the model key.
 */
export const Route = createFileRoute('/models/$modelId/records/')({
  component: ModelRecords,
})

function ModelRecords() {
  const { modelId } = Route.useParams()
  return <RecordModelRecords modelKey={modelId} />
}
