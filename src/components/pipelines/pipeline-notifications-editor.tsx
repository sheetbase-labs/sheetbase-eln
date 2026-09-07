import { FormSection } from '#/components/ui/form-section'
import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Label, Select, Textarea } from '#/components/ui'
import type { PipelineConfig } from '#/lib/pipelines/config'

type Notification = NonNullable<PipelineConfig['notifications']>[number]
export function PipelineNotificationsEditor({
  notifications,
  subscriptions,
  loading,
  error,
  onChange,
  onValidityChange,
}: {
  notifications: Notification[]
  subscriptions: { id: string; key: string }[]
  loading: boolean
  error: boolean
  onChange: (notifications: Notification[]) => void
  onValidityChange: (valid: boolean) => void
}) {
  const [drafts, setDrafts] = useState(() =>
    notifications.map((item) => ({
      raw: item.payload ? JSON.stringify(item.payload, null, 2) : '',
      error: '',
    })),
  )
  useEffect(
    () => onValidityChange(drafts.every((draft) => !draft.error)),
    [drafts, onValidityChange],
  )
  return (
    <FormSection
      title="Notifications"
      hint="After a successful run, send a signed message to a connected webhook."
    >
      <div className="space-y-3">
        {notifications.map((notification, index) => (
          <div key={index} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Select
                aria-label={`Notification ${index + 1}`}
                value={notification.subscriptionId}
                onChange={(event) =>
                  onChange(
                    notifications.map((item, i) =>
                      i === index
                        ? { ...item, subscriptionId: event.target.value }
                        : item,
                    ),
                  )
                }
              >
                <option value="">Choose a webhook…</option>
                {subscriptions.map((subscription) => (
                  <option key={subscription.id} value={subscription.id}>
                    {subscription.key}
                  </option>
                ))}
              </Select>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove notification ${index + 1}`}
                onClick={() => {
                  setDrafts(drafts.filter((_, i) => i !== index))
                  onChange(notifications.filter((_, i) => i !== index))
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Label htmlFor={`notification-payload-${index}`}>
              Values to send (optional JSON)
            </Label>
            <p className="text-xs text-muted-foreground">
              Choose the values to send, or leave blank for a run summary.
            </p>
            <Textarea
              id={`notification-payload-${index}`}
              aria-label={`Notification ${index + 1} payload`}
              aria-invalid={Boolean(drafts[index]?.error)}
              className="min-h-28 font-mono text-xs leading-5"
              spellCheck={false}
              value={drafts[index]?.raw ?? ''}
              onChange={(event) => {
                const raw = event.target.value
                let message = ''
                try {
                  const payload: unknown = raw.trim()
                    ? JSON.parse(raw)
                    : undefined
                  if (
                    payload !== undefined &&
                    (!payload ||
                      typeof payload !== 'object' ||
                      Array.isArray(payload))
                  )
                    throw new Error('Invalid payload')
                  onChange(
                    notifications.map((item, i) =>
                      i === index
                        ? {
                            subscriptionId: item.subscriptionId,
                            ...(payload !== undefined
                              ? { payload: payload as Record<string, unknown> }
                              : {}),
                          }
                        : item,
                    ),
                  )
                } catch {
                  message =
                    'Enter a JSON object, or leave this blank for a run summary.'
                }
                setDrafts(
                  drafts.map((item, i) =>
                    i === index ? { raw, error: message } : item,
                  ),
                )
              }}
            />
            {drafts[index]?.error && (
              <p role="alert" className="text-xs text-destructive">
                {drafts[index].error}
              </p>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Use results in your message
              </summary>
              <pre className="mt-2 overflow-auto rounded-md bg-muted/40 p-3">
                {
                  '{ "value": { "$ref": "previous.0.value" },\n  "project": { "$ref": "actions.project.id" } }'
                }
              </pre>
              <p className="mt-1 text-muted-foreground">
                References use the run’s parameters, analysis rows or named
                action results.
              </p>
            </details>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={notifications.length >= 10}
          onClick={() => {
            setDrafts([...drafts, { raw: '', error: '' }])
            onChange([...notifications, { subscriptionId: '' }])
          }}
        >
          <Plus className="size-4" /> Add notification
        </Button>
        {loading && (
          <p role="status" className="text-xs text-muted-foreground">
            Loading webhooks…
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            Could not load webhooks. Reload to try again.
          </p>
        )}
        {!loading && !error && subscriptions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Add a webhook in Administration → Webhooks to enable notifications.
          </p>
        )}
      </div>
    </FormSection>
  )
}
