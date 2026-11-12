import { useState } from 'react'
import { z } from 'zod'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { rich, t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Muted } from '#/components/ui/layout'
import { Notice } from '#/components/ui/alert'
import { toast } from '#/components/ui/sonner'
import { Status } from '#/components/ui/status'
import { notebookDataClient } from '#/lib/notebook-data'
import { PIPELINE_ACTIONS } from '#/lib/pipelines/actions'
import type { PipelineConfigView as PipelineConfig } from '#/lib/pipelines/config-view'

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

/** An incoming webhook: an instrument or another system starts a run by
 * posting to the URL with the signing token. */
export function WebhookCard({ definitionId }: { definitionId: string }) {
  const queryClient = useQueryClient()
  const [issued, setIssued] = useState<string | null>(null)

  const state = useQuery({
    queryKey: webhookKey(definitionId),
    queryFn: () => webhookRequest(definitionId, 'GET'),
  })

  const change = useMutation({
    mutationFn: (action: 'rotate' | 'disable') =>
      webhookRequest(definitionId, 'PUT', action),
    onSuccess: (next, action) => {
      queryClient.setQueryData(webhookKey(definitionId), {
        enabled: next.enabled,
        url: next.url,
      })
      setIssued(action === 'rotate' ? (next.token ?? null) : null)
    },
    onError: (error) =>
      toast(t('data.triggersOutputs.couldChangeWebhook'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.triggersOutputs.serverRefused'),
      }),
  })

  const enabled = state.data?.enabled ?? false

  return (
    <div className="rounded border border-line">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-fg">
            {t('data.triggersOutputs.incomingWebhook')}
          </div>
          <Muted>
            {t('data.triggersOutputs.instrumentAnotherSystemStart')}
          </Muted>
        </div>
        {state.isLoading ? (
          <Muted>{t('common.states.loading')}</Muted>
        ) : (
          <Status tone={enabled ? 'ok' : 'none'}>
            {enabled
              ? t('data.triggersOutputs.on')
              : t('data.triggersOutputs.off')}
          </Status>
        )}
        {enabled ? (
          <Button
            disabled={change.isPending}
            onClick={() => change.mutate('disable')}
          >
            {t('data.triggersOutputs.turnOff')}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={change.isPending || state.isError}
            onClick={() => change.mutate('rotate')}
          >
            {t('data.triggersOutputs.turnOn')}
          </Button>
        )}
      </div>
      {state.isError ? (
        <div className="border-t border-line px-3 py-2.5">
          <Notice tone="warn">
            {state.error instanceof Error
              ? state.error.message
              : t('data.triggersOutputs.webhookCouldRead')}
          </Notice>
        </div>
      ) : null}
      {enabled && state.data ? (
        <WebhookCredentials
          url={state.data.url}
          issued={issued}
          pending={change.isPending}
          onRotate={() => change.mutate('rotate')}
        />
      ) : null}
    </div>
  )
}

function WebhookCredentials({
  url,
  issued,
  pending,
  onRotate,
}: {
  url: string
  issued: string | null
  pending: boolean
  onRotate: () => void
}) {
  return (
    <div className="grid gap-3 border-t border-line bg-surface-sunken px-3 py-3">
      <div>
        <div className="text-caption text-fg-muted">
          {t('data.triggersOutputs.url')}
        </div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded border border-line bg-surface px-2 py-1 text-caption">
            {url}
          </code>
          <Button
            icon="copy"
            onClick={() => {
              void Promise.resolve()
                .then(() => navigator.clipboard.writeText(url))
                .then(() => toast(t('data.triggersOutputs.urlCopied')))
                .catch(() => toast(t('data.triggersOutputs.couldCopyUrl')))
            }}
          >
            {t('common.actions.copy')}
          </Button>
        </div>
      </div>
      <div>
        <div className="text-caption text-fg-muted">
          {t('data.triggersOutputs.signingToken')}
        </div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded border border-line bg-surface px-2 py-1 text-caption">
            {issued ?? '••••••••••••••••••••'}
          </code>
          <Button disabled={pending} onClick={onRotate}>
            {t('data.triggersOutputs.rotate')}
          </Button>
        </div>
      </div>
      <Muted>
        {issued
          ? t('data.triggersOutputs.copyTokenNowShown')
          : t('data.triggersOutputs.requestsWithoutTokenWithout')}{' '}
        {t('data.triggersOutputs.requestBodyPassParameters')}
      </Muted>
    </div>
  )
}

const KEEPS = [
  {
    mode: 'none',
    title: t('data.triggersOutputs.keepNothing'),
    help: t('data.triggersOutputs.inputsEveryStepResult'),
  },
  {
    mode: 'append',
    title: t('data.triggersOutputs.saveStepResultSnapshot'),
    help: t('data.triggersOutputs.chooseStepDatasetNew'),
  },
  {
    mode: 'create',
    title: t('data.triggersOutputs.saveStepResultNew'),
    help: t('data.triggersOutputs.createsDatasetModelChoose'),
  },
] as const

/** What a run keeps: the output mode of the version being shown. Changing it
 * is done in Steps, where the dataset and the column match are chosen. */
export function RunKeeps({
  config,
  pipelineId,
}: {
  config: Partial<PipelineConfig>
  pipelineId: string
}) {
  const mode = config.output?.mode ?? 'none'

  return (
    <div className="grid gap-2">
      {KEEPS.map((option) => {
        const selected = option.mode === mode

        return (
          <div
            key={option.mode}
            role="radio"
            aria-checked={selected}
            className={`flex gap-2.5 rounded border px-3 py-2.5 ${
              selected ? 'border-primary bg-selected' : 'border-line'
            }`}
          >
            <span
              aria-hidden
              className={`mt-1 size-3 shrink-0 rounded-full border ${
                selected ? 'border-4 border-primary' : 'border-line-strong'
              }`}
            />
            <div className="min-w-0">
              <div className="text-body font-medium text-fg">
                {option.title}
              </div>
              <Muted>{option.help}</Muted>
            </div>
          </div>
        )
      })}
      <Muted>
        {rich('data.triggersOutputs.changeWhereResultGoes', {
          link: (text) => (
            <Link
              to="/pipelines/$pipelineId/steps"
              params={{ pipelineId }}
              className="text-link underline"
            >
              {text}
            </Link>
          ),
        })}
      </Muted>
    </div>
  )
}

/** An extension step reads as its own name: `plugin.k.summarise-values` becomes “Summarise values”. */
function actionLabel(operation: string): string {
  const known = ACTION_LABEL.get(operation)

  if (known) return known
  const parts = operation.split('.')

  if (parts[0] !== 'plugin' || parts.length < 3) return operation
  const words = parts.slice(2).join(' ').replace(/-/g, ' ')

  return words.charAt(0).toUpperCase() + words.slice(1)
}

const ACTION_LABEL = new Map(
  PIPELINE_ACTIONS.map((a) => [a.operation, a.label] as const),
)

/** The ELN actions a run takes, and whether a person decides each one. */
export function ElnActions({ config }: { config: Partial<PipelineConfig> }) {
  const actions = config.actions ?? []

  return (
    <div>
      <h3 className="mb-1 text-body font-semibold text-fg">
        {t('data.triggersOutputs.elnActions')}
      </h3>
      {actions.length ? (
        <table className="w-full text-left text-caption">
          <thead className="text-fg-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">
                {t('data.triggersOutputs.action')}
              </th>
              <th className="py-1 pr-3 font-medium">
                {t('data.triggersOutputs.where')}
              </th>
              <th className="py-1 font-medium">
                {t('data.triggersOutputs.needsPerson')}
              </th>
            </tr>
          </thead>
          <tbody>
            {actions.map((action) => {
              const target = action.arguments.p_record_id
              const propose = action.mode === 'propose'

              return (
                <tr key={action.name} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-fg">
                    {actionLabel(action.operation)}
                  </td>
                  <td className="py-1.5 pr-3 text-fg-muted">
                    {action.forEach
                      ? t('data.triggersOutputs.eachRow')
                      : z.string().safeParse(target).success
                        ? t('data.triggersOutputs.aRecord')
                        : t('data.triggersOutputs.theRun')}
                  </td>
                  <td className="py-1.5 text-fg-muted">
                    {propose
                      ? t('data.triggersOutputs.yesAcceptsRejects')
                      : t('data.triggersOutputs.no')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <Muted>{t('data.triggersOutputs.versionTakesElnActions')}</Muted>
      )}
    </div>
  )
}

interface DestinationWire {
  id: string
  key: string
  description: string | null
  status: string
}

/** Who hears about a run, read from the webhook destinations it is wired to. */
export function RunNotifications({
  config,
}: {
  config: Partial<PipelineConfig>
}) {
  const targets = config.notifications ?? []
  const ids = targets.map((target) => target.subscriptionId)

  const destinations = useQuery({
    queryKey: ['ui-port', 'pipelines', 'notification-destinations', ids],
    enabled: ids.length > 0,
    queryFn: () =>
      notebookDataClient.list<DestinationWire>(
        'webhook_subscriptions',
        `?id=in.(${ids.join(',')})&select=id,key,description,status`,
      ),
  })

  const byId = new Map((destinations.data ?? []).map((d) => [d.id, d]))

  return (
    <div>
      <h3 className="mb-1 text-body font-semibold text-fg">
        {t('data.triggersOutputs.notifications')}
      </h3>
      {targets.length ? (
        <table className="w-full text-left text-caption">
          <thead className="text-fg-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">
                {t('data.triggersOutputs.message')}
              </th>
              <th className="py-1 pr-3 font-medium">
                {t('data.triggersOutputs.to')}
              </th>
              <th className="py-1 font-medium">
                {t('data.triggersOutputs.when')}
              </th>
            </tr>
          </thead>
          <tbody>
            {targets.map((target) => {
              const destination = byId.get(target.subscriptionId)

              return (
                <tr
                  key={target.subscriptionId}
                  className="border-t border-line"
                >
                  <td className="py-1.5 pr-3 text-fg">
                    {t('data.triggersOutputs.runSummary')}
                  </td>
                  <td className="py-1.5 pr-3 text-fg-muted">
                    {destination
                      ? destination.description?.trim() || destination.key
                      : t('data.triggersOutputs.aDestination')}
                    {destination && destination.status !== 'active'
                      ? ` (${destination.status})`
                      : ''}
                  </td>
                  <td className="py-1.5 text-fg-muted">
                    {t('data.triggersOutputs.succeeded')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <Muted>{t('data.triggersOutputs.oneNotifiedWhenRun')}</Muted>
      )}
    </div>
  )
}
