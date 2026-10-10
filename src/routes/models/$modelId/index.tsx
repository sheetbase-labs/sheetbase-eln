import { createFileRoute, redirect } from '@tanstack/react-router'

import { isUuid } from '#/lib/field-value-validation'

/**
 * A dataset-schema model (uuid) opens on Fields; a workspace-defined record
 * model (ADR-0051, addressed by its stable key) opens on its Records list.
 */
export const Route = createFileRoute('/models/$modelId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: isUuid(params.modelId)
        ? '/models/$modelId/fields'
        : '/models/$modelId/records',
      params,
    })
  },
})
