import { createFileRoute, redirect } from '@tanstack/react-router'

import { isUuid } from '#/lib/field-value-validation'

import { RecordModelRecords } from '#/components/v3/models/record-model-records'

/**
 * MDL-04.1: the records list of a workspace-defined record model. `$modelId`
 * is the model key (e.g. `cell_bank`); the frame (`/models/$modelId`) resolves
 * the model and falls back to the built-in surface when the key is a built-in
 * kind. Rows are `api.records` where `kind` is the model key.
 */
export const Route = createFileRoute('/models/$modelId/records/')({
  // A dataset-schema model is addressed by uuid and has no record list: the
  // key lookup below would answer "Model not found" for a model that exists.
  beforeLoad: ({ params }) => {
    if (isUuid(params.modelId))
      throw redirect({ to: '/models/$modelId/fields', params })
  },
  component: ModelRecords,
})

function ModelRecords() {
  const { modelId } = Route.useParams()
  return <RecordModelRecords modelKey={modelId} />
}
