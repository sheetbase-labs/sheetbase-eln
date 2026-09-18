import { useEffect, useState } from 'react'
import { Button, Input } from '#/components/ui'

type Settings = { enabled: boolean; url: string; token?: string }

/** A credential is shown only immediately after creation or rotation. */
export function PipelineWebhookTrigger({
  definitionId,
  canManage = true,
}: {
  definitionId: string
  canManage?: boolean
}) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endpoint = `/api/pipelines/webhook/${definitionId}`
  useEffect(() => {
    let active = true
    setSettings(null)
    setError(null)
    if (!canManage) return
    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Webhook settings could not be loaded.')
        const value = (await response.json()) as Settings
        if (active) setSettings(value)
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Webhook settings could not be loaded.',
          )
      })
    return () => {
      active = false
    }
  }, [endpoint, canManage])
  async function update(action: 'rotate' | 'disable') {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!response.ok)
        throw new Error(
          'Webhook settings could not be saved. Check your permissions and try again.',
        )
      setSettings((await response.json()) as Settings)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Webhook settings could not be saved.',
      )
    } finally {
      setPending(false)
    }
  }
  if (!canManage) return null
  return (
    <section className="space-y-3" aria-labelledby="pipeline-webhook-heading">
      <div>
        <h3 id="pipeline-webhook-heading" className="text-sm font-semibold">
          Incoming webhook
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Start the latest published version when another service sends an
          event. Runs use your current workspace permissions.
        </p>
      </div>
      {!settings && !error ? (
        <p className="text-sm text-muted-foreground">
          Loading webhook settings…
        </p>
      ) : null}
      {settings ? (
        <>
          <p className="text-sm">
            {settings.enabled ? 'Webhook enabled' : 'Webhook disabled'}
          </p>
          {settings.enabled ? (
            <>
              <label className="block space-y-1 text-sm">
                Webhook URL
                <Input
                  readOnly
                  value={settings.url}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              {settings.token ? (
                <label className="block space-y-1 text-sm">
                  Token — copy and store it now
                  <Input
                    readOnly
                    value={settings.token}
                    autoComplete="off"
                    onFocus={(event) => event.target.select()}
                  />
                  <span className="block text-xs text-muted-foreground">
                    This token is only shown once. Keep it private.
                  </span>
                </label>
              ) : null}
              <p className="text-xs leading-relaxed text-muted-foreground">
                Send POST with Authorization: Bearer followed by your token and
                a unique Idempotency-Key header for each event. Retry the same
                event with the same key. Send a JSON object containing
                parameters and inputVersions; inputVersions maps input names to
                dataset version IDs.
              </p>
              <p className="text-xs text-muted-foreground">
                Replacing the token immediately disconnects services using the
                previous token.
              </p>
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void update('rotate')}
            >
              {pending
                ? 'Saving…'
                : settings.enabled
                  ? 'Replace token'
                  : 'Enable webhook'}
            </Button>
            {settings.enabled ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void update('disable')}
              >
                Disable webhook
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}
