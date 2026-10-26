import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Muted } from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { toast } from '#/components/v3/ui/sonner'
import { Status } from '#/components/v3/ui/status'
import { notebookDataClient } from '#/lib/notebook-data'
import { PIPELINE_ACTIONS } from '#/lib/pipelines/actions'
import type { PipelineConfig } from '#/lib/pipelines/config'

/** The webhook that starts a run, as the management endpoint reports it. The
 * token is only ever returned when it is created or rotated. */
export interface WebhookTriggerState {
  enabled: boolean
  url: string
  token?: string
}

const webhookKey = (definitionId: string) =>
  ['ui-port', 'pipelines', 'webhook-trigger', definitionId] as const

async function webhookRequest(
  definitionId: string,
  method: 'GET' | 'PUT',
  action?: 'rotate' | 'disable',
): Promise<WebhookTriggerState> {
  const response = await fetch(`/api/pipelines/webhook/${definitionId}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'PUT' ? JSON.stringify({ action }) : undefined,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error ?? 'The webhook could not be read.')
  }
  return (await response.json()) as WebhookTriggerState
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
    onError: (error: unknown) =>
      toast('Could not change the webhook', {
        description:
          error instanceof Error ? error.message : 'The server refused it.',
      }),
  })
  const enabled = state.data?.enabled ?? false
  return (
    <div className="max-w-xl rounded border border-line">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-fg">Incoming webhook</div>
          <Muted>For an instrument or another system to start a run</Muted>
        </div>
        {state.isLoading ? (
          <Muted>Loading…</Muted>
        ) : (
          <Status tone={enabled ? 'ok' : 'none'}>
            {enabled ? 'On' : 'Off'}
          </Status>
        )}
        {enabled ? (
          <Button
            disabled={change.isPending}
            onClick={() => change.mutate('disable')}
          >
            Turn off
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={change.isPending || state.isError}
            onClick={() => change.mutate('rotate')}
          >
            Turn on
          </Button>
        )}
      </div>
      {state.isError ? (
        <div className="border-t border-line px-3 py-2.5">
          <Notice tone="warn">
            {state.error instanceof Error
              ? state.error.message
              : 'The webhook could not be read.'}
          </Notice>
        </div>
      ) : null}
      {enabled && state.data ? (
        <div className="grid gap-3 border-t border-line bg-surface-sunken px-3 py-3">
          <div>
            <div className="text-caption text-fg-muted">URL</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-line bg-surface px-2 py-1 text-caption">
                {state.data.url}
              </code>
              <Button
                icon="copy"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(state.data?.url ?? '')
                    .then(() => toast('URL copied'))
                    .catch(() => toast('Could not copy the URL'))
                }}
              >
                Copy
              </Button>
            </div>
          </div>
          <div>
            <div className="text-caption text-fg-muted">Signing token</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-line bg-surface px-2 py-1 text-caption">
                {issued ?? '••••••••••••••••••••'}
              </code>
              <Button
                disabled={change.isPending}
                onClick={() => change.mutate('rotate')}
              >
                Rotate…
              </Button>
            </div>
          </div>
          <Muted>
            {issued
              ? 'Copy the token now. It is not shown again, and rotating replaces it.'
              : 'Requests without the token, or without an Idempotency-Key, are rejected.'}{' '}
            The request body can pass parameters and input versions. It can’t
            choose datasets the run may not read.
          </Muted>
        </div>
      ) : null}
    </div>
  )
}

const KEEPS = [
  {
    mode: 'none',
    title: 'Keep nothing',
    help: 'Inputs and every step result are temporary and deleted when the run ends. The run record, logs and row counts stay.',
  },
  {
    mode: 'append',
    title: 'Save a step result as a snapshot of an existing dataset',
    help: 'Choose the step and the dataset. The new snapshot records this run as its source.',
  },
  {
    mode: 'create',
    title: 'Save a step result as a new dataset',
    help: 'Creates a dataset with a model you choose. Nothing is created until a run succeeds.',
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
    <div className="grid max-w-xl gap-2">
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
        To change where a result goes,{' '}
        <Link
          to="/pipelines/$pipelineId/steps"
          params={{ pipelineId }}
          className="text-link underline"
        >
          edit the output in Steps
        </Link>
        .
      </Muted>
    </div>
  )
}

const ACTION_LABEL = new Map(
  PIPELINE_ACTIONS.map((a) => [a.operation, a.label] as const),
)

/** The ELN actions a run takes, and whether a person decides each one. */
export function ElnActions({ config }: { config: Partial<PipelineConfig> }) {
  const actions = config.actions ?? []
  return (
    <div>
      <h3 className="mb-1 text-body font-semibold text-fg">ELN actions</h3>
      {actions.length ? (
        <table className="w-full text-left text-caption">
          <thead className="text-fg-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">Action</th>
              <th className="py-1 pr-3 font-medium">Where</th>
              <th className="py-1 font-medium">Needs a person</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((action) => {
              const target = action.arguments.p_record_id
              const propose = (action as { mode?: string }).mode === 'propose'
              return (
                <tr key={action.name} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-fg">
                    {ACTION_LABEL.get(action.operation) ?? action.operation}
                  </td>
                  <td className="py-1.5 pr-3 text-fg-muted">
                    {typeof target === 'string' ? 'A record' : 'The run'}
                  </td>
                  <td className="py-1.5 text-fg-muted">
                    {propose ? 'Yes, accepts or rejects' : 'No'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <Muted>This version takes no ELN actions.</Muted>
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
  const ids = targets.map((t) => t.subscriptionId)
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
      <h3 className="mb-1 text-body font-semibold text-fg">Notifications</h3>
      {targets.length ? (
        <table className="w-full text-left text-caption">
          <thead className="text-fg-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">Message</th>
              <th className="py-1 pr-3 font-medium">To</th>
              <th className="py-1 font-medium">When</th>
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
                  <td className="py-1.5 pr-3 text-fg">Run summary</td>
                  <td className="py-1.5 pr-3 text-fg-muted">
                    {destination
                      ? destination.description?.trim() || destination.key
                      : 'A destination'}
                    {destination && destination.status !== 'active'
                      ? ` (${destination.status})`
                      : ''}
                  </td>
                  <td className="py-1.5 text-fg-muted">Succeeded</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <Muted>No one is notified when a run finishes.</Muted>
      )}
    </div>
  )
}
