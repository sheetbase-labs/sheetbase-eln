import { createFileRoute } from '@tanstack/react-router'

import { RecordModelNew } from '#/components/v3/models/record-model-new'

/** MDL-04.2: generated "new record" form for a workspace record model. */
export const Route = createFileRoute('/models/$modelId/records/new')({
  component: ModelRecordNew,
})

function ModelRecordNew() {
  const { modelId } = Route.useParams()
  return <RecordModelNew modelKey={modelId} />
}
