import { z } from 'zod'

import { t } from '#/copy'

/** The webhook that starts a run, as the management endpoint reports it. The
 * token is only ever returned when it is created or rotated. */
export interface WebhookTriggerState {
  enabled: boolean
  url: string
  token?: string
}

export const webhookKey = (definitionId: string) =>
  ['ui-port', 'pipelines', 'webhook-trigger', definitionId] as const

export async function webhookRequest(
  definitionId: string,
  method: 'GET' | 'PUT',
  action?: 'rotate' | 'disable',
): Promise<WebhookTriggerState> {
  const request: RequestInit = {
    method,
    headers: { 'content-type': 'application/json' },
  }

  if (method === 'PUT') request.body = JSON.stringify({ action })

  const response = await fetch(
    `/api/pipelines/webhook/${definitionId}`,
    request,
  )

  if (!response.ok) {
    const body = z
      .object({ error: z.string().optional() })
      .safeParse(await response.json().catch(() => null))

    throw new Error(
      (body.success ? body.data.error : undefined) ??
        t('data.triggersOutputs.webhookCouldRead'),
    )
  }

  return z
    .object({
      enabled: z.boolean(),
      url: z.string(),
      token: z.string().optional(),
    })
    .parse(await response.json())
}
