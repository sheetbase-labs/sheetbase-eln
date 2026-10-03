import { createFileRoute } from '@tanstack/react-router'

import { RecordModelRecord } from '#/components/v3/models/record-model-record'

/**
 * MDL-04.3: a record page for a workspace record model. `$modelId` is the
 * model key; `$recordId` is the record uuid.
 */
export const Route = createFileRoute('/models/$modelId/records/$recordId')({
  component: ModelRecordDetail,
})

function ModelRecordDetail() {
  const { modelId, recordId } = Route.useParams()
  return <RecordModelRecord modelKey={modelId} recordId={recordId} />
}
