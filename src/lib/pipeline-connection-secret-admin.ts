/**
 * Client-callable server functions for the sealed secrets of a pipeline
 * connection (owners, admins and stewards, in the app). Every server-only
 * dependency loads inside the handler. A value is set or rotated and never
 * returned to anyone.
 */
import { createServerFn } from '@tanstack/react-start'

import { WEB_SECRET_NAME_RE } from './pipelines/web-call'

export const setPipelineConnectionSecretFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      workspaceId: string
      connectionId: string
      secretName: string
      value: string
    }) => input,
  )
  .handler(async ({ data }) => {
    if (!WEB_SECRET_NAME_RE.test(data.secretName))
      throw new Error('A secret is named with letters, digits and _.')

    const { setConnectionSecret } =
      await import('./pipeline-connection-secrets.server')

    return setConnectionSecret(
      data.workspaceId,
      data.connectionId,
      data.secretName,
      data.value,
    )
  })

export const deletePipelineConnectionSecretFn = createServerFn({
  method: 'POST',
})
  .validator(
    (input: {
      workspaceId: string
      connectionId: string
      secretName: string
    }) => input,
  )
  .handler(async ({ data }) => {
    const { deleteConnectionSecret } =
      await import('./pipeline-connection-secrets.server')

    return deleteConnectionSecret(
      data.workspaceId,
      data.connectionId,
      data.secretName,
    )
  })
